import { useEffect, useState } from 'react';
import type { NoteDoc } from '@yan/core/contracts';

export interface MetaPanelProps {
  doc: NoteDoc;
  /** 只提交改动过的字段；空字符串会被清理掉 */
  onSave: (patch: Record<string, unknown>) => void;
}

function str(v: unknown): string {
  if (typeof v === 'string') return v;
  if (typeof v === 'number') return String(v);
  return '';
}

function list(v: unknown): string {
  if (Array.isArray(v)) return v.map((x) => String(x)).join(', ');
  return str(v);
}

function splitList(v: string): string[] {
  return v
    .split(/[,，]/)
    .map((s) => s.trim())
    .filter(Boolean);
}

export function MetaPanel({ doc, onSave }: MetaPanelProps): React.ReactElement {
  const [project, setProject] = useState('');
  const [engine, setEngine] = useState('');
  const [platform, setPlatform] = useState('');
  const [tags, setTags] = useState('');
  const [nodes, setNodes] = useState('');

  useEffect(() => {
    setProject(str(doc.frontmatter.project));
    setEngine(str(doc.frontmatter.engine));
    setPlatform(str(doc.frontmatter.platform));
    setTags(list(doc.frontmatter.tags));
    setNodes(list(doc.frontmatter.nodes));
  }, [doc.path, doc.mtimeMs, doc.frontmatter]);

  const commit = (patch: Record<string, unknown>): void => onSave(patch);

  const type = str(doc.frontmatter.type) || 'note';

  return (
    <div className="meta">
      <div className="meta-head">
        <span className="meta-type">{type}</span>
        <span className="meta-status">{str(doc.frontmatter.status)}</span>
      </div>

      <Field label="项目" value={project} onChange={setProject} onCommit={() => commit({ project: project || undefined })} />
      <Field label="引擎" value={engine} onChange={setEngine} onCommit={() => commit({ engine: engine || undefined })} />
      <Field label="平台" value={platform} onChange={setPlatform} onCommit={() => commit({ platform: platform || undefined })} />
      <Field
        label="标签"
        value={tags}
        placeholder="逗号分隔"
        onChange={setTags}
        onCommit={() => commit({ tags: splitList(tags) })}
      />
      <Field
        label="关联节点"
        value={nodes}
        placeholder="框架节点名，逗号分隔"
        onChange={setNodes}
        onCommit={() => commit({ nodes: splitList(nodes) })}
      />
    </div>
  );
}

function Field({
  label,
  value,
  placeholder,
  onChange,
  onCommit,
}: {
  label: string;
  value: string;
  placeholder?: string;
  onChange: (v: string) => void;
  onCommit: () => void;
}): React.ReactElement {
  return (
    <label className="meta-row">
      <span className="meta-label">{label}</span>
      <input
        className="meta-input"
        value={value}
        placeholder={placeholder ?? '—'}
        onChange={(e) => onChange(e.target.value)}
        onBlur={onCommit}
        onKeyDown={(e) => {
          if (e.key === 'Enter') {
            e.currentTarget.blur();
          }
        }}
      />
    </label>
  );
}
