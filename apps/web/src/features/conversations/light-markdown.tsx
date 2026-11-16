import { Fragment, type ReactNode } from 'react';

// COM-09, COM-13 : mise en forme légère (gras, italique, liens, listes) construite en éléments
// React, jamais en HTML ; tout le reste est du texte, échappé par React.

const INLINE = /(\*\*[^*\n]+\*\*|_[^_\n]+_|https?:\/\/[^\s<>"']+)/g;

function inline(text: string, key: string): ReactNode[] {
  return text.split(INLINE).map((part, index) => {
    const k = `${key}-${String(index)}`;
    if (part.startsWith('**') && part.endsWith('**') && part.length > 4) {
      return <strong key={k}>{part.slice(2, -2)}</strong>;
    }
    if (part.startsWith('_') && part.endsWith('_') && part.length > 2) {
      return <em key={k}>{part.slice(1, -1)}</em>;
    }
    if (/^https?:\/\//.test(part)) {
      return (
        <a key={k} href={part} target="_blank" rel="noopener noreferrer" className="underline">
          {part}
        </a>
      );
    }
    return <Fragment key={k}>{part}</Fragment>;
  });
}

export function LightMarkdown({ text }: { text: string }) {
  const blocks: ReactNode[] = [];
  let list: string[] = [];
  const flush = (key: string) => {
    if (list.length === 0) return;
    blocks.push(
      <ul key={key} className="list-disc pl-5">
        {list.map((line, i) => (
          <li key={i}>{inline(line, `${key}-${String(i)}`)}</li>
        ))}
      </ul>,
    );
    list = [];
  };
  text.split('\n').forEach((line, index) => {
    if (line.startsWith('- ')) {
      list.push(line.slice(2));
      return;
    }
    flush(`ul-${String(index)}`);
    if (line.trim().length > 0) {
      blocks.push(
        <p key={`p-${String(index)}`} className="break-words">
          {inline(line, `p-${String(index)}`)}
        </p>,
      );
    }
  });
  flush('ul-end');
  return <div className="flex flex-col gap-1 text-sm">{blocks}</div>;
}
