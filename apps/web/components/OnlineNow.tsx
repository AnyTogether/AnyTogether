import type { Strings } from "@/lib/i18n";
import { fill } from "@/lib/people";
import { loadOnline } from "@/lib/site";

/** "12 players online now" under the Find players heading: a count only, never who. People who
 *  are invisible or hide their status are not in it, and the hint says so. Nothing shows while
 *  the count is not there or nobody is counted. */
export async function OnlineNow({ texts }: { texts: Strings }) {
  const online = (await loadOnline())?.online ?? 0;
  if (!Number.isInteger(online) || online < 1) return null;
  const n = new Intl.NumberFormat(texts.language).format(online);
  return (
    <p className="online-now" title={texts.onlineNowHint}>
      <i className="dot" />
      <span>{fill(online === 1 ? texts.onlineNowOne : texts.onlineNowMany, { n })}</span>
      <span className="visually-hidden"> {texts.onlineNowHint}</span>
    </p>
  );
}
