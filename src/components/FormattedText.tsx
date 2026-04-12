import { marked } from 'marked';

marked.setOptions({
  breaks: true,
  gfm: true,
});

export default function FormattedText({ text }: { text: string }) {
  const html = marked.parse(text) as string;
  return (
    <span
      className="formatted-text"
      dangerouslySetInnerHTML={{ __html: html }}
    />
  );
}
