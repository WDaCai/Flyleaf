import { useEffect, useRef } from 'react';
import { EditorState } from '@codemirror/state';
import {
  EditorView,
  drawSelection,
  highlightActiveLine,
  highlightActiveLineGutter,
  keymap,
  lineNumbers,
  placeholder,
} from '@codemirror/view';
import { defaultKeymap, history, historyKeymap } from '@codemirror/commands';
import { markdown } from '@codemirror/lang-markdown';
import { bracketMatching, indentOnInput, syntaxHighlighting } from '@codemirror/language';
import { oneDarkHighlightStyle } from '@codemirror/theme-one-dark';

export interface EditorProps {
  /** 切换文件时变化，用于重建编辑器 */
  docKey: string;
  value: string;
  onChange: (body: string) => void;
}

const theme = EditorView.theme(
  {
    '&': { backgroundColor: 'transparent', color: '#d7dbe0', height: '100%', fontSize: '14px' },
    '.cm-scroller': { fontFamily: 'var(--mono)', lineHeight: '1.6', overflow: 'auto' },
    '.cm-content': { padding: '18px 0', caretColor: '#7aa2f7' },
    '.cm-gutters': {
      backgroundColor: 'transparent',
      color: '#454e5c',
      border: 'none',
      paddingRight: '6px',
      userSelect: 'none',
    },
    '.cm-activeLine': { backgroundColor: 'rgba(122,162,247,0.045)' },
    '.cm-activeLineGutter': { backgroundColor: 'transparent', color: '#8a93a0' },
    '.cm-selectionBackground, ::selection': { backgroundColor: 'rgba(122,162,247,0.22) !important' },
    '.cm-cursor': { borderLeftColor: '#7aa2f7', borderLeftWidth: '2px' },
    '.cm-placeholder': { color: '#454e5c' },
    '.cm-line': { padding: '0 18px' },
  },
  { dark: true },
);

export function Editor({ docKey, value, onChange }: EditorProps): React.ReactElement {
  const host = useRef<HTMLDivElement | null>(null);
  const onChangeRef = useRef(onChange);
  onChangeRef.current = onChange;

  useEffect(() => {
    const el = host.current;
    if (!el) return;

    const view = new EditorView({
      parent: el,
      state: EditorState.create({
        doc: value,
        extensions: [
          lineNumbers(),
          highlightActiveLineGutter(),
          highlightActiveLine(),
          drawSelection(),
          history(),
          bracketMatching(),
          indentOnInput(),
          markdown(),
          syntaxHighlighting(oneDarkHighlightStyle),
          EditorView.lineWrapping,
          placeholder('开始写……'),
          keymap.of([...defaultKeymap, ...historyKeymap]),
          EditorView.updateListener.of((u) => {
            if (u.docChanged) onChangeRef.current(u.state.doc.toString());
          }),
          theme,
        ],
      }),
    });

    view.focus();

    return () => {
      view.destroy();
    };
    // 只在切文件时重建；value 的后续变化由父层忽略
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [docKey]);

  return <div className="editor-host" ref={host} />;
}
