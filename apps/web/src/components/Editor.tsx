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
import { bracketMatching, defaultHighlightStyle, indentOnInput, syntaxHighlighting } from '@codemirror/language';
import { oneDarkHighlightStyle } from '@codemirror/theme-one-dark';

export type UiTheme = 'dark' | 'light';

export interface EditorProps {
  /** 切换文件时变化，用于重建编辑器 */
  docKey: string;
  value: string;
  onChange: (body: string) => void;
  /** 主界面主题：驱动编辑器浅/深色 */
  uiTheme?: UiTheme;
}

function buildTheme(dark: boolean) {
  return EditorView.theme(
    {
      '&': {
        backgroundColor: 'transparent',
        color: 'var(--editor-fg)',
        height: '100%',
        fontSize: '14px',
      },
      '.cm-scroller': { fontFamily: 'var(--mono)', lineHeight: '1.65', overflow: 'auto' },
      '.cm-content': { padding: '20px 0', caretColor: 'var(--editor-caret)' },
      '.cm-gutters': {
        backgroundColor: 'transparent',
        color: 'var(--editor-gutter)',
        border: 'none',
        paddingRight: '8px',
        userSelect: 'none',
      },
      '.cm-activeLine': { backgroundColor: 'var(--editor-active-line)' },
      '.cm-activeLineGutter': { backgroundColor: 'transparent', color: 'var(--editor-gutter-active)' },
      '.cm-selectionBackground, ::selection': { backgroundColor: 'var(--editor-selection) !important' },
      '.cm-cursor': { borderLeftColor: 'var(--editor-caret)', borderLeftWidth: '2px' },
      '.cm-placeholder': { color: 'var(--editor-placeholder)' },
      '.cm-line': { padding: '0 20px' },
    },
    { dark },
  );
}

export function Editor({ docKey, value, onChange, uiTheme = 'dark' }: EditorProps): React.ReactElement {
  const host = useRef<HTMLDivElement | null>(null);
  const onChangeRef = useRef(onChange);
  onChangeRef.current = onChange;

  useEffect(() => {
    const el = host.current;
    if (!el) return;

    const dark = uiTheme !== 'light';
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
          syntaxHighlighting(dark ? oneDarkHighlightStyle : defaultHighlightStyle),
          EditorView.lineWrapping,
          placeholder('开始写……'),
          keymap.of([...defaultKeymap, ...historyKeymap]),
          EditorView.updateListener.of((u) => {
            if (u.docChanged) onChangeRef.current(u.state.doc.toString());
          }),
          buildTheme(dark),
        ],
      }),
    });

    view.focus();

    return () => {
      view.destroy();
    };
    // 切文件或主题时重建；value 的后续变化由父层忽略
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [docKey, uiTheme]);

  return <div className="editor-host" ref={host} />;
}
