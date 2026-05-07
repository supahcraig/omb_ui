import CodeMirror from '@uiw/react-codemirror'
import { yaml } from '@codemirror/lang-yaml'
import { oneDark } from '@codemirror/theme-one-dark'

interface Props {
  value: string
  onChange: (val: string) => void
  readOnly?: boolean
}

export default function YamlEditor({ value, onChange, readOnly }: Props) {
  return (
    <CodeMirror
      value={value}
      extensions={[yaml()]}
      theme={oneDark}
      readOnly={readOnly}
      onChange={onChange}
      className="text-xs border border-slate-700 rounded overflow-hidden h-full"
      basicSetup={{ lineNumbers: true, foldGutter: true }}
    />
  )
}
