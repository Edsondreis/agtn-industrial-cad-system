# Componentes de terceiros

O AGTN Industrial CAD é software proprietário da AGTN. Usa os componentes abaixo, sem modificação, conforme
suas licenças.

## acadrust 0.6.8 — MPL-2.0
Leitura e gravação de DWG (R12–R2018) e DXF. Código-fonte: https://github.com/hakanaktt/acadrust
(crates.io: https://crates.io/crates/acadrust). Licença: Mozilla Public License 2.0 —
https://mozilla.org/MPL/2.0/. A MPL é copyleft por arquivo: só os arquivos do próprio acadrust ficam sob a MPL;
o código do AGTN Industrial CAD não é afetado. Se algum dia algum arquivo do acadrust for alterado, essa
alteração deve ser publicada sob a MPL.

## occt-wasm 5.17.1 — MIT OR Apache-2.0 (código TypeScript) · Open CASCADE Technology 8 — LGPL-2.1 com exceção
Motor geométrico 3D (B-Rep) do AGTN 3D. Código-fonte: https://github.com/andymai/occt-wasm (npm `occt-wasm`).
O arquivo compilado `occt-wasm.wasm` contém o **Open CASCADE Technology** (https://dev.opencascade.org,
código-fonte https://github.com/Open-Cascade-SAS/OCCT), licenciado sob a GNU LGPL 2.1 com a "Open CASCADE
Exception 1.0". Este software faz uso de recursos fornecidos pelo Open CASCADE Technology.
O `.wasm` é distribuído como arquivo separado, carregado em tempo de execução, e pode ser substituído pelo usuário
por outra compilação compatível, conforme a LGPL.

## three.js 0.187.0 — MIT
Renderização do viewport do AGTN 3D. Código-fonte: https://github.com/mrdoob/three.js.
Copyright © 2010-2026 three.js authors. Licença MIT (mesmo texto da seção do ACadSharp abaixo).

## ACadSharp — MIT
O leitor/gravador DWG do acadrust inclui código adaptado do ACadSharp.

Copyright (c) 2021 Albert Domenech

Permission is hereby granted, free of charge, to any person obtaining a copy of this software and associated
documentation files (the "Software"), to deal in the Software without restriction, including without limitation
the rights to use, copy, modify, merge, publish, distribute, sublicense, and/or sell copies of the Software, and
to permit persons to whom the Software is furnished to do so, subject to the following conditions:

The above copyright notice and this permission notice shall be included in all copies or substantial portions
of the Software.

THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR IMPLIED, INCLUDING BUT NOT LIMITED TO
THE WARRANTIES OF MERCHANTABILITY, FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER LIABILITY, WHETHER IN AN ACTION OF
CONTRACT, TORT OR OTHERWISE, ARISING FROM, OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS
IN THE SOFTWARE.

As amostras DWG de teste (`tests/dwg`) também vêm do ACadSharp (MIT).

## Métricas da fonte Helvetica (Adobe Core 14 AFM)
O PDF gerado na impressão usa a Helvetica, uma das 14 fontes-padrão do PDF (não é embutida no arquivo). As
larguras dos caracteres em `modules/plot/src/helvetica.ts` vêm dos arquivos AFM públicos da Adobe:

Copyright (c) 1985, 1987, 1989, 1990, 1997 Adobe Systems Incorporated. All Rights Reserved.
This file and the 14 PostScript(R) AFM files it accompanies may be used, copied, and distributed for any purpose
and without charge, with or without modification provided that all copyright notices are retained; that the AFM
files are not distributed without this file; that all modifications to this file or any of the AFM files are
prominently noted in the modified file(s); and that this paragraph is not modified. Adobe Systems has no
responsibility or obligation to support the use of the AFM files.

## Arquivos de teste gerados pelo ezdxf — MIT
`tests/dxf/fixtures/curvas.dxf` foi gerado com o ezdxf (Manfred Moitzi, licença MIT) apenas para testes.
