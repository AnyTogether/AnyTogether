/** A controller for the front page's last call. The body is Phosphor's "game-controller" (thin
 *  weight), MIT licensed:
 *
 *    Copyright (c) 2023 Phosphor Icons. Permission is hereby granted, free of charge, to any person
 *    obtaining a copy of this software, to deal in it without restriction (MIT License,
 *    https://github.com/phosphor-icons/core/blob/main/LICENSE). The software is provided "as is",
 *    without warranty of any kind.
 *
 *  The touchpad, the D-pad, the sticks and the four face buttons in their seat colours are drawn
 *  on top of it here. The face buttons light in turn while it is on screen (not with reduced
 *  motion). Purely decorative. */
const body =
  "M238.21,198.36a32,32,0,0,1-48.84,4.27l-.17-.18L148.29,156H107.72L66.81,202.44l-.18.19A32.08,32.08,0,0,1,44,212a32,32,0,0,1-31.5-37.56L28.87,90.21A55.87,55.87,0,0,1,83.89,44H172a56.07,56.07,0,0,1,55.1,46.1.29.29,0,0,1,0,.1l16.37,84.16A31.86,31.86,0,0,1,238.21,198.36ZM172,148a48,48,0,1,0,0-96H83.9A47.9,47.9,0,0,0,36.74,91.67L20.36,175.9a24,24,0,0,0,19.48,27.73,24,24,0,0,0,21-6.58l42-47.69a4,4,0,0,1,3-1.36Zm63.63,27.83-11-56.66A56.09,56.09,0,0,1,172,156H159l36.16,41.06a24,24,0,0,0,40.52-21.23Z";

const faces = [
  { key: "triangle", x: 172, y: 86 },
  { key: "circle", x: 190, y: 104 },
  { key: "cross", x: 172, y: 122 },
  { key: "square", x: 154, y: 104 },
] as const;

export function Controller() {
  return (
    <svg className="pad-art" viewBox="0 0 256 256" aria-hidden="true">
      <path className="pad-body" d={body} />
      <rect className="pad-touch" x="106" y="58" width="44" height="24" rx="6" />
      <path className="pad-dpad" d="M80 90h10v10h10v10H90v10H80v-10H70v-10h10z" />
      <circle className="pad-stick" cx="110" cy="128" r="10" />
      <circle className="pad-stick" cx="146" cy="128" r="10" />
      {faces.map((face) => (
        <g key={face.key} className={`pad-face ${face.key}`}>
          <circle cx={face.x} cy={face.y} r="8" />
          {face.key === "triangle" && (
            <path d={`M${face.x} ${face.y - 3.6}l3.4 6h-6.8z`} className="pad-glyph" />
          )}
          {face.key === "circle" && <circle cx={face.x} cy={face.y} r="3.2" className="pad-glyph" />}
          {face.key === "cross" && (
            <path
              d={`M${face.x - 3} ${face.y - 3}l6 6M${face.x + 3} ${face.y - 3}l-6 6`}
              className="pad-glyph"
            />
          )}
          {face.key === "square" && (
            <rect x={face.x - 3} y={face.y - 3} width="6" height="6" className="pad-glyph" />
          )}
        </g>
      ))}
    </svg>
  );
}
