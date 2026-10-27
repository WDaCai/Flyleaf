Set sh = CreateObject("Wscript.Shell")
Set fso = CreateObject("Scripting.FileSystemObject")
dir = fso.GetParentFolderName(WScript.ScriptFullName)
sh.CurrentDirectory = dir
sh.Environment("PROCESS")("FLYLEAF_VAULT") = "E:\Notes"
' 由已签名的 cmd 启动，避免资源管理器直接打开未签名 exe 时弹出 SmartScreen
sh.Run "cmd /c start """" /D """ & dir & """ Flyleaf.exe", 0, False
