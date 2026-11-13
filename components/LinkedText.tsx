import { Fragment } from "react";
import { isAcceptableSourceLink, normalizeSourceLink } from "@/lib/source-links";

// Web addresses typed into the text: with a scheme, or starting with "www.".
const URL_PATTERN = /(https?:\/\/[^\s<>"]+|www\.[^\s<>"]+)/gi;

/** Opens in a new tab without telling the other site where the reader came from. */
export function ExternalLink({ href, children }: { href: string; children: React.ReactNode }) {
  return (
    <a href={href} target="_blank" rel="noopener noreferrer nofollow ugc" referrerPolicy="no-referrer">
      {children}
    </a>
  );
}

/** Plain text with any web address in it turned into a clickable link. Everything else stays text. */
export default function LinkedText({ text }: { text: string }) {
  return (
    <>
      {text.split(URL_PATTERN).map((part, i) => {
        if (i % 2 === 0) return <Fragment key={i}>{part}</Fragment>;
        // Punctuation that ended the sentence stays outside the link.
        const shown = part.replace(/[>\]"'”’.,;:!?।)]+$/, "");
        const href = normalizeSourceLink(shown);
        if (!shown || !isAcceptableSourceLink(href)) return <Fragment key={i}>{part}</Fragment>;
        return (
          <Fragment key={i}>
            <ExternalLink href={href}>{shown}</ExternalLink>
            {part.slice(shown.length)}
          </Fragment>
        );
      })}
    </>
  );
}
