//! Conversor DWG ↔ DXF próprio do AGTN Industrial CAD — sem programas externos.
//!
//! Motor: crate `acadrust` (Rust puro, MPL-2.0; leitura e gravação nativas de DWG R12–R2018 e DXF).
//! A MPL-2.0 é copyleft só por arquivo: o crate é usado sem modificação, o código do AGTN CAD
//! continua proprietário (aviso de licença em `docs/TERCEIROS.md`).
//!
//! ISOLAMENTO: o app é compilado com `panic = "abort"`. Um DWG corrompido que faça o leitor
//! entrar em pânico não pode derrubar a janela; por isso a conversão roda em um processo filho —
//! o próprio executável chamado com `--agtn-cadconv` (veja `main.rs`). Se o filho cair, só a
//! conversão daquele arquivo falha e o usuário recebe a mensagem.

use acadrust::types::DxfVersion;
use acadrust::{CadDocument, Layer, DwgReadOptions, DwgReader, DwgWriter, DxfReader, DxfReaderConfiguration, DxfWriter};
use std::io::Cursor;
use std::path::Path;

/// Argumento que coloca o executável em modo conversor (sem janela).
pub const CLI_FLAG: &str = "--agtn-cadconv";

/// Limite de memória descompactada por leitura (protege contra arquivos maliciosos/corrompidos).
const MAX_DECOMPRESSED: usize = 1536 * 1024 * 1024;

/// Versões aceitas (identificadores usados pela interface).
pub const VERSIONS: [(&str, DxfVersion); 8] = [
    ("ACAD12", DxfVersion::AC1009),
    ("ACAD14", DxfVersion::AC1014),
    ("ACAD2000", DxfVersion::AC1015),
    ("ACAD2004", DxfVersion::AC1018),
    ("ACAD2007", DxfVersion::AC1021),
    ("ACAD2010", DxfVersion::AC1024),
    ("ACAD2013", DxfVersion::AC1027),
    ("ACAD2018", DxfVersion::AC1032),
];

pub fn version_from_id(id: &str) -> Result<DxfVersion, String> {
    VERSIONS
        .iter()
        .find(|(k, _)| k.eq_ignore_ascii_case(id))
        .map(|(_, v)| *v)
        .ok_or_else(|| format!("Versão inválida: {id}"))
}

#[derive(Clone, Copy, PartialEq, Eq, Debug)]
pub enum Format {
    Dxf,
    Dwg,
}

impl Format {
    pub fn parse(s: &str) -> Result<Self, String> {
        match s.to_ascii_uppercase().as_str() {
            "DXF" => Ok(Format::Dxf),
            "DWG" => Ok(Format::Dwg),
            _ => Err(format!("Formato inválido: {s}")),
        }
    }
    pub fn of_path(p: &Path) -> Result<Self, String> {
        let ext = p.extension().map(|e| e.to_string_lossy().to_string()).unwrap_or_default();
        Format::parse(&ext).map_err(|_| format!("\"{}\" não é DWG nem DXF.", p.display()))
    }
    pub fn ext(self) -> &'static str {
        match self {
            Format::Dxf => "dxf",
            Format::Dwg => "dwg",
        }
    }
}

fn is_dwg_signature(bytes: &[u8]) -> bool {
    bytes.len() >= 6 && &bytes[0..2] == b"AC" && bytes[2..6].iter().all(|b| b.is_ascii_digit())
}

/// Lê DWG ou DXF. Tenta o modo estrito; se falhar, o modo tolerante (recupera o que for possível).
/// O formato é decidido pela assinatura do arquivo (um ".dwg" que na verdade é DXF também abre).
pub fn read_doc(bytes: Vec<u8>) -> Result<CadDocument, String> {
    if is_dwg_signature(&bytes) {
        let strict = DwgReadOptions { max_decompressed_bytes: Some(MAX_DECOMPRESSED), ..DwgReadOptions::default() };
        match DwgReader::from_stream_with_options(Cursor::new(bytes.clone()), strict).read() {
            Ok(d) => Ok(d),
            Err(e1) => {
                let tolerant = DwgReadOptions { max_decompressed_bytes: Some(MAX_DECOMPRESSED), ..DwgReadOptions::failsafe() };
                let d = DwgReader::from_stream_with_options(Cursor::new(bytes), tolerant)
                    .read()
                    .map_err(|e2| format!("DWG ilegível: {e1} ({e2})"))?;
                // modo tolerante sem nada aproveitável = arquivo danificado, não "desenho vazio"
                if d.entities().next().is_none() {
                    return Err(format!("DWG danificado ou não suportado: {e1}"));
                }
                Ok(d)
            }
        }
    } else {
        let read = |failsafe: bool| {
            DxfReader::from_reader(Cursor::new(bytes.clone()))
                .map(|r| r.with_configuration(DxfReaderConfiguration { failsafe, ..Default::default() }))
                .and_then(|r| r.read())
        };
        match read(false) {
            Ok(d) => Ok(d),
            Err(e1) => {
                let d = read(true).map_err(|e2| format!("DXF ilegível: {e1} ({e2})"))?;
                if d.entities().next().is_none() {
                    return Err(format!("Arquivo danificado ou não é DWG/DXF: {e1}"));
                }
                Ok(d)
            }
        }
    }
}

/// Camadas usadas por entidades mas ausentes da tabela (comum em DXF "enxuto" de CAM) são criadas;
/// sem isso o DWG gravado ficaria inválido.
fn ensure_layers(doc: &mut CadDocument) {
    let mut missing: Vec<String> = Vec::new();
    for e in doc.entities() {
        let l = &e.common().layer;
        if !l.is_empty() && !doc.layers.contains(l) && !missing.contains(l) {
            missing.push(l.clone());
        }
    }
    for name in missing {
        let _ = doc.layers.add(Layer::new(name));
    }
}

fn write_dwg(mut doc: CadDocument, version: DxfVersion) -> Result<Vec<u8>, String> {
    doc.version = version;
    DwgWriter::write_to_vec(&doc).map_err(|e| e.to_string())
}

/// Grava o documento no formato/versão pedidos.
pub fn write_doc(mut doc: CadDocument, format: Format, version: DxfVersion) -> Result<Vec<u8>, String> {
    ensure_layers(&mut doc);
    match format {
        Format::Dxf => DxfWriter::new(&doc).with_version(version).write_to_vec().map_err(|e| format!("Falha ao gravar DXF: {e}")),
        Format::Dwg => write_dwg(doc.clone(), version).or_else(|e1| {
            // Objetos que a versão de destino não comporta (ex.: tabelas de dados num DWG R12):
            // passa pelo DXF R12, que converte entidades novas em equivalentes simples, e grava de novo.
            let simple = DxfWriter::new(&doc)
                .with_version(DxfVersion::AC1009)
                .write_to_vec()
                .map_err(|e| e.to_string())
                .and_then(|b| read_doc(b))
                .map_err(|_| format!("Falha ao gravar DWG: {e1}"))?;
            write_dwg(simple, version).map_err(|e2| format!("Falha ao gravar DWG: {e1} ({e2})"))
        }),
    }
}

/// Conversão completa em memória.
pub fn convert_bytes(input: Vec<u8>, format: Format, version: DxfVersion) -> Result<Vec<u8>, String> {
    if input.is_empty() {
        return Err("Arquivo vazio.".into());
    }
    let doc = read_doc(input)?;
    let out = write_doc(doc, format, version)?;
    if out.is_empty() {
        return Err("A conversão gerou um arquivo vazio.".into());
    }
    Ok(out)
}

/// Modo conversor do executável: `agtn-cad --agtn-cadconv <entrada> <saída> <DXF|DWG> <VERSÃO> <arquivo-de-erro>`.
/// Retorna o código de saída do processo.
pub fn cli_main(args: &[String]) -> i32 {
    let report = |err_path: Option<&String>, msg: &str| {
        if let Some(p) = err_path {
            let _ = std::fs::write(p, msg.as_bytes());
        }
        eprintln!("{msg}");
    };
    if args.len() < 5 {
        report(args.get(5), "uso: --agtn-cadconv <entrada> <saída> <DXF|DWG> <VERSÃO> <erro>");
        return 2;
    }
    let (input, output, format, version, err) = (&args[1], &args[2], &args[3], &args[4], args.get(5));
    let r = (|| {
        let format = Format::parse(format)?;
        let version = version_from_id(version)?;
        let bytes = std::fs::read(input).map_err(|e| format!("Não foi possível ler \"{input}\": {e}"))?;
        let out = convert_bytes(bytes, format, version)?;
        std::fs::write(output, out).map_err(|e| format!("Não foi possível gravar: {e}"))
    })();
    match r {
        Ok(()) => 0,
        Err(m) => {
            report(err, &m);
            1
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn versions_map() {
        assert_eq!(version_from_id("ACAD2018").unwrap(), DxfVersion::AC1032);
        assert_eq!(version_from_id("acad12").unwrap(), DxfVersion::AC1009);
        assert!(version_from_id("ACAD9").is_err());
        assert_eq!(Format::of_path(Path::new("a/Peça.DWG")).unwrap(), Format::Dwg);
        assert!(Format::of_path(Path::new("a.pdf")).is_err());
    }

    /// DXF R12 no estilo do AGTN CAD (linha + círculo + arco + polilinha fechada).
    fn sample_dxf() -> Vec<u8> {
        let mut s = String::from("0\nSECTION\n2\nENTITIES\n");
        s += "0\nLINE\n8\nCONTORNO_CORTE\n10\n0\n20\n0\n30\n0\n11\n200\n21\n0\n31\n0\n";
        s += "0\nCIRCLE\n8\n0\n10\n50\n20\n40\n30\n0\n40\n12.5\n";
        s += "0\nARC\n8\n0\n10\n100\n20\n40\n30\n0\n40\n20\n50\n0\n51\n90\n";
        s += "0\nPOLYLINE\n8\nLINHAS_DOBRA\n66\n1\n70\n1\n10\n0\n20\n0\n30\n0\n";
        for (x, y) in [(0.0, 0.0), (100.0, 0.0), (100.0, 50.0), (0.0, 50.0)] {
            s += &format!("0\nVERTEX\n8\nLINHAS_DOBRA\n10\n{x}\n20\n{y}\n30\n0\n");
        }
        s += "0\nSEQEND\n0\nENDSEC\n0\nEOF\n";
        s.into_bytes()
    }

    #[test]
    fn dxf_to_dwg_every_version_and_back() {
        for (id, v) in VERSIONS {
            let dwg = convert_bytes(sample_dxf(), Format::Dwg, v).unwrap_or_else(|e| panic!("{id}: {e}"));
            assert!(is_dwg_signature(&dwg), "{id}: assinatura DWG");
            let back = read_doc(dwg).unwrap_or_else(|e| panic!("{id} reler: {e}"));
            assert_eq!(back.entities().count(), 4, "{id}: entidades");
            let dxf = convert_bytes(write_doc(back, Format::Dwg, v).unwrap(), Format::Dxf, DxfVersion::AC1032).unwrap();
            let txt = String::from_utf8_lossy(&dxf);
            assert!(txt.contains("CIRCLE") && txt.contains("LINHAS_DOBRA") && txt.contains("CONTORNO_CORTE"), "{id}: conteúdo");
        }
    }

    #[test]
    fn garbage_is_an_error_not_a_crash() {
        assert!(convert_bytes(Vec::new(), Format::Dxf, DxfVersion::AC1032).is_err());
        let noise: Vec<u8> = (0..4096u32).map(|i| (i.wrapping_mul(2246822519) >> 11) as u8).collect();
        assert!(convert_bytes(noise, Format::Dwg, DxfVersion::AC1032).is_err(), "lixo sem cabeçalho");
        let mut junk = b"AC1032".to_vec();
        junk.extend((0..4096u32).map(|i| (i.wrapping_mul(2654435761) >> 13) as u8));
        assert!(convert_bytes(junk, Format::Dxf, DxfVersion::AC1032).is_err());
    }

    #[test]
    fn cli_reports_errors_to_file() {
        let dir = std::env::temp_dir().join(format!("agtn-cadconv-{}", std::process::id()));
        std::fs::create_dir_all(&dir).unwrap();
        let input = dir.join("entrada.dxf");
        std::fs::write(&input, sample_dxf()).unwrap();
        let out = dir.join("saída.dwg");
        let err = dir.join("e.txt");
        let a = |o: &Path, f: &str| {
            vec![CLI_FLAG.to_string(), input.display().to_string(), o.display().to_string(), f.into(), "ACAD2018".into(), err.display().to_string()]
        };
        assert_eq!(cli_main(&a(&out, "DWG")), 0);
        assert!(is_dwg_signature(&std::fs::read(&out).unwrap()));
        assert_eq!(cli_main(&a(&out, "PDF")), 1);
        assert!(std::fs::read_to_string(&err).unwrap().contains("Formato inválido"));
        let _ = std::fs::remove_dir_all(dir);
    }

    /// DXF 2000 gravado pelo próprio AGTN CAD (elipse, spline, hachura, MTEXT, LWPOLYLINE):
    /// o conversor lê e grava DWG em todas as versões; de 2004 em diante os objetos voltam nativos.
    #[test]
    fn agtn_dxf2000_keeps_curves_in_dwg() {
        use acadrust::entities::EntityType as T;
        let src = include_bytes!("../../../../tests/dxf/fixtures/agtn_r2000.dxf").to_vec();
        let doc = read_doc(src).expect("ler DXF 2000 do AGTN");
        let kinds = |d: &CadDocument| {
            let mut k = [0usize; 5];
            for e in d.entities() {
                match e {
                    T::Ellipse(_) => k[0] += 1,
                    T::Spline(_) => k[1] += 1,
                    T::Hatch(_) => k[2] += 1,
                    T::MText(_) => k[3] += 1,
                    T::LwPolyline(_) => k[4] += 1,
                    _ => {}
                }
            }
            k
        };
        assert_eq!(kinds(&doc), [2, 2, 2, 1, 1], "leitura do DXF 2000");
        for (id, ver) in VERSIONS {
            let back = write_doc(doc.clone(), Format::Dwg, ver).and_then(read_doc).unwrap_or_else(|e| panic!("{id}: {e}"));
            assert!(back.entities().count() > 0, "{id}: vazio");
            if matches!(id, "ACAD2004" | "ACAD2007" | "ACAD2010" | "ACAD2013" | "ACAD2018") {
                assert_eq!(kinds(&back), [2, 2, 2, 1, 1], "{id}: objetos modernos devem voltar nativos");
            }
        }
    }

    /// DWGs reais gerados pelo AutoCAD (pasta `tests/dwg` do repositório; CI define AGTN_DWG_SAMPLES).
    /// Cada um é lido e regravado em todas as versões de DWG e DXF, e relido.
    #[test]
    fn real_autocad_samples() {
        let Ok(dir) = std::env::var("AGTN_DWG_SAMPLES") else { return };
        let mut files: Vec<_> = std::fs::read_dir(&dir)
            .unwrap()
            .flatten()
            .map(|e| e.path())
            .filter(|p| p.extension().map(|x| x.eq_ignore_ascii_case("dwg")).unwrap_or(false))
            .collect();
        files.sort();
        assert!(!files.is_empty(), "nenhum DWG em {dir}");
        let mut fails = Vec::new();
        for p in &files {
            let v = p.file_name().unwrap().to_string_lossy().to_string();
            let doc = read_doc(std::fs::read(p).unwrap()).unwrap_or_else(|e| panic!("{v}: {e}"));
            let n = doc.entities().count();
            assert!(n > 100, "{v}: {n}");
            for (id, ver) in VERSIONS {
                match write_doc(doc.clone(), Format::Dwg, ver).and_then(read_doc) {
                    Ok(back) if back.entities().count() > 0 => {}
                    Ok(_) => fails.push(format!("{v}→{id}: vazio")),
                    Err(e) => fails.push(format!("{v}→{id}: {e}")),
                }
                match write_doc(doc.clone(), Format::Dxf, ver).and_then(read_doc) {
                    Ok(back) if back.entities().count() > 0 => {}
                    Ok(_) => fails.push(format!("{v}→DXF {id}: vazio")),
                    Err(e) => fails.push(format!("{v}→DXF {id}: {e}")),
                }
            }
        }
        assert!(fails.is_empty(), "{}", fails.join("\n"));
    }
}

