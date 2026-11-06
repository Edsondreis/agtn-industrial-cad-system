; AGTN Industrial CAD — ganchos do instalador NSIS (bundle > windows > nsis > installerHooks).
;
; Ao final da instalação pergunta se .dwg e .dxf devem abrir no AGTN Industrial CAD por padrão.
;  - Sim: a classe do AGTN vira a padrão e a escolha anterior guardada pelo Windows para essas
;    extensões (UserChoice) é removida — duplo clique passa a abrir no AGTN CAD.
;  - Não: devolve o programa que era padrão antes (o AGTN CAD fica só em "Abrir com").
; A resposta fica gravada; atualizações não perguntam de novo nem mexem na escolha.
; Instalação silenciosa (/S) não altera o programa padrão.

!define AGTN_PREFKEY "Software\AGTN\AGTN Industrial CAD"
!define AGTN_FILEEXTS "Software\Microsoft\Windows\CurrentVersion\Explorer\FileExts"

!macro AGTN_RESTORE_PREVIOUS EXT CLASS
  ; padrão anterior salvo pelo APP_ASSOCIATE do Tauri (ignora se o "anterior" já era o AGTN)
  ReadRegStr $1 SHCTX "Software\Classes\.${EXT}" "${CLASS}_backup"
  StrCmp $1 "${CLASS}" +2 0
  WriteRegStr SHCTX "Software\Classes\.${EXT}" "" "$1"
!macroend

!macro AGTN_MAKE_DEFAULT EXT
  DeleteRegKey HKCU "${AGTN_FILEEXTS}\.${EXT}\UserChoice"
  DeleteRegKey HKCU "${AGTN_FILEEXTS}\.${EXT}\UserChoiceLatest"
!macroend

!macro NSIS_HOOK_POSTINSTALL
  ; o AGTN CAD sempre aparece em "Abrir com"
  WriteRegStr SHCTX "Software\Classes\.dwg\OpenWithProgids" "AGTNCAD.DWG" ""
  WriteRegStr SHCTX "Software\Classes\.dxf\OpenWithProgids" "AGTNCAD.DXF" ""

  ClearErrors
  ReadRegDWORD $0 HKCU "${AGTN_PREFKEY}" "PadraoDwgDxf"
  IfErrors agtn_ask agtn_known

  agtn_ask:
    MessageBox MB_YESNO|MB_ICONQUESTION "Abrir arquivos .dwg e .dxf com o AGTN Industrial CAD por padrão?$\r$\n$\r$\nCom duplo clique, desenhos DWG e DXF abrirão direto no AGTN Industrial CAD.$\r$\nVocê pode mudar depois em Preferências." /SD IDNO IDYES agtn_yes IDNO agtn_no

  agtn_yes:
    WriteRegDWORD HKCU "${AGTN_PREFKEY}" "PadraoDwgDxf" 1
    !insertmacro AGTN_MAKE_DEFAULT "dwg"
    !insertmacro AGTN_MAKE_DEFAULT "dxf"
    Goto agtn_done

  agtn_no:
    ${IfNot} ${Silent}
      WriteRegDWORD HKCU "${AGTN_PREFKEY}" "PadraoDwgDxf" 0
    ${EndIf}
    Goto agtn_restore

  agtn_known:
    IntCmp $0 1 agtn_done agtn_restore agtn_restore

  agtn_restore:
    !insertmacro AGTN_RESTORE_PREVIOUS "dwg" "AGTNCAD.DWG"
    !insertmacro AGTN_RESTORE_PREVIOUS "dxf" "AGTNCAD.DXF"

  agtn_done:
    !insertmacro UPDATEFILEASSOC
!macroend

!macro NSIS_HOOK_POSTUNINSTALL
  DeleteRegValue SHCTX "Software\Classes\.dwg\OpenWithProgids" "AGTNCAD.DWG"
  DeleteRegValue SHCTX "Software\Classes\.dxf\OpenWithProgids" "AGTNCAD.DXF"
  ; mantém a resposta se for só atualização; na desinstalação de verdade, esquece
  ${IfNot} ${Silent}
    DeleteRegValue HKCU "${AGTN_PREFKEY}" "PadraoDwgDxf"
  ${EndIf}
!macroend
