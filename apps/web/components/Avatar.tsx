import { type Person, type PresenceState, initialOf, shownAvatar, shownName } from "@/lib/people";
import type { CSSProperties } from "react";

/** A person's picture, or the first letter of their name on the brand gradient; a presence dot if
 *  given. A friend's friends-only picture and name come first when the API gave them. */
export function Avatar({
  person,
  size = 40,
  presence,
}: {
  person: Pick<Person, "handle" | "displayName" | "avatar" | "privateName" | "privateAvatar">;
  size?: number;
  presence?: PresenceState;
}) {
  // Each person keeps the same angle of the gradient, so a list of letters does not look stamped.
  let hash = 0;
  for (const char of person.handle) hash = (hash * 31 + char.charCodeAt(0)) >>> 0;
  const style = { "--size": `${size}px`, "--turn": `${hash % 360}deg` } as CSSProperties;
  return (
    <span className="avatar" style={style}>
      {shownAvatar(person) ? (
        <img src={shownAvatar(person) ?? ""} alt="" width={size} height={size} loading="lazy" />
      ) : (
        <span aria-hidden="true">{initialOf(shownName(person) || person.handle)}</span>
      )}
      {presence && <i className={`presence is-${presence}`} />}
    </span>
  );
}
