/* 壳层小笔触。只给侧栏和空状态用，不进编辑器或 draw.io。 */

function Ico({
  className,
  children,
}: {
  className?: string;
  children: React.ReactNode;
}): React.ReactElement {
  const name = className ? `doodle-ico ${className}` : 'doodle-ico';
  return (
    <svg className={name} viewBox="0 0 16 16" aria-hidden="true">
      {children}
    </svg>
  );
}

export function DoodlePlus(): React.ReactElement {
  return (
    <Ico>
      <path d="M8.1 2.6c.15 2.1-.35 4.5.1 6.4.25 1.4-.15 2.8.05 4.2" />
      <path d="M3 8.05c2.2-.25 4.3.3 6.2-.1 1.5-.2 2.5.15 3.7-.05" />
    </Ico>
  );
}

export function DoodleSearch(): React.ReactElement {
  return (
    <Ico>
      <circle cx="7" cy="7" r="3.15" />
      <path d="M9.5 9.6c.7.7 2.1 2.2 3.1 3.1" />
    </Ico>
  );
}

export function DoodleFolder(): React.ReactElement {
  return (
    <Ico>
      <path d="M2.5 5.3c.15-.9.9-1.35 2.1-1.25h2l1.15 1.25h4.15c.95.05 1.45.5 1.4 1.5v4.55c-.05.95-.55 1.4-1.5 1.45H4.05c-1.05.05-1.6-.4-1.55-1.45V5.3z" />
    </Ico>
  );
}

export function DoodleTrash(): React.ReactElement {
  return (
    <Ico>
      <path d="M3.3 4.5h9.4" />
      <path d="M6.3 4.4c.15-.85.75-1.35 1.7-1.35s1.55.5 1.7 1.35" />
      <path d="M4.3 5.3l.55 7.7c.05.7.45.95 1.15.95h4c.7 0 1.05-.25 1.15-.95l.55-7.7" />
    </Ico>
  );
}

export function DoodleLeaf(): React.ReactElement {
  return (
    <Ico className="foot-leaf">
      <path d="M3.1 12.7C6.4 12 8.7 8.4 13 3.2 10.2 7.2 8.1 10.4 3.1 12.7z" fill="currentColor" stroke="none" />
      <path d="M3.4 12.5c2.5-1.5 4.5-3.2 6.6-6" />
    </Ico>
  );
}
