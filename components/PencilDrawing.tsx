type Drawing = "record" | "place" | "voices" | "prepare" | "privacy" | "track";
const drawings: Record<Drawing, { lines: string[]; accents: string[] }> = {
  record: {
    lines: [
      "M64 44 L143 40 L162 58 L165 132 L67 136 Z M143 40 L144 59 L162 58",
      "M77 36 L151 32 L169 49 L172 124 M57 54 L59 144 L154 140",
      "M81 66 Q103 62 126 65 M81 77 L144 74 M82 94 L95 93 L95 106 L82 107 Z M105 97 L147 95 M105 106 L137 104 M83 119 L144 117",
      "M45 153 Q113 148 184 151",
    ],
    accents: ["M83 97 L88 102 L99 89", "M81 79 L114 77"],
  },
  place: {
    lines: [
      "M40 69 L85 53 L132 67 L178 52 L181 133 L136 149 L88 135 L42 151 Z",
      "M85 53 L88 135 M132 99 L136 149 M52 90 L71 82 M53 104 L71 97 M101 110 L119 115 M150 114 L168 108",
      "M114 42 C96 41 93 61 103 74 L115 91 L129 72 C141 55 130 41 114 42 Z",
      "M109 57 C109 49 121 49 122 56 C123 65 109 65 109 57 Z",
      "M92 91 C75 107 104 124 120 129 M120 129 L116 122 M120 129 L111 131",
      "M32 161 Q115 154 191 158",
    ],
    accents: [
      "M114 42 C96 41 93 61 103 74 L115 91 L129 72 C141 55 130 41 114 42 Z",
      "M148 82 L166 76",
    ],
  },
  voices: {
    lines: [
      "M49 51 Q33 53 35 68 L37 91 Q39 100 52 100 L58 112 L68 98 L99 96 Q111 94 110 82 L108 60 Q107 48 95 49 Z",
      "M131 34 Q119 37 120 49 L121 70 Q122 82 135 82 L159 81 L173 94 L172 78 Q185 77 185 65 L183 43 Q182 32 169 32 Z",
      "M97 108 Q82 109 83 122 L84 139 Q85 150 98 150 L125 149 L139 161 L139 146 Q152 145 151 131 L150 118 Q149 106 136 107 Z",
      "M51 67 L88 65 M52 80 L78 79 M133 48 L168 47 M134 61 L158 60 M97 123 L135 121 M98 136 L122 135",
      "M116 88 L121 95 M71 118 L73 125",
    ],
    accents: ["M52 81 L77 80", "M134 63 L158 62", "M97 137 L121 136"],
  },
  prepare: {
    lines: [
      "M55 37 Q102 25 156 35 L161 143 Q105 132 57 146 Z M64 40 L67 139",
      "M79 53 L122 50 M79 62 L145 60 M81 79 L91 79 L91 89 L81 89 Z M102 82 L144 80 M82 104 L92 104 L92 114 L82 114 Z M103 107 L137 105 M83 130 L126 128",
      "M139 141 L145 123 L183 65 L195 73 L156 132 Z M145 123 L156 132 M149 126 L188 69 M139 141 L145 138",
      "M183 65 L187 59 Q190 55 193 58 L198 62 Q201 64 198 68 L195 73",
      "M44 156 Q112 150 177 155",
    ],
    accents: [
      "M79 83 L85 88 L96 74",
      "M81 108 L87 113 L99 99",
      "M187 59 Q190 55 193 58 L198 62 Q201 64 198 68 L195 73 L183 65 Z",
    ],
  },
  privacy: {
    lines: [
      "M109 27 Q141 45 170 43 L168 89 C164 122 142 143 111 158 C81 144 57 122 54 91 L51 44 Q83 44 109 27 Z",
      "M109 35 Q139 52 161 50 L159 89 Q155 126 111 148 Q70 128 63 92 L61 51 Q84 51 109 35 Z",
      "M89 82 L89 71 C89 43 132 43 132 71 L132 82 M81 82 L141 81 L141 119 L82 120 Z",
      "M109 92 C101 92 103 104 110 103 L109 110 M110 103 C118 103 118 91 109 92",
      "M40 112 L30 114 M184 70 L195 65 M183 81 L197 83",
      "M64 168 Q111 164 158 168",
    ],
    accents: ["M92 72 C92 49 128 49 128 72", "M91 133 L110 146 L130 133"],
  },
  track: {
    lines: [
      "M60 37 L158 35 L162 144 L63 147 Z M53 45 L55 154 L153 151",
      "M77 57 L139 55 M78 69 L122 67 M79 91 L91 91 L91 103 L79 103 Z M103 94 L144 92 M80 117 L92 117 L92 128 L80 128 Z M104 120 L139 118",
      "M151 105 C151 86 181 86 181 104 C181 122 151 123 151 105 Z M176 117 L191 134 M166 97 L166 105 L173 109",
      "M42 166 Q113 160 188 164",
    ],
    accents: [
      "M78 95 L84 101 L96 86",
      "M104 122 L130 120",
      "M166 97 L166 105 L173 109",
    ],
  },
};

export default function PencilDrawing({ kind }: { kind: Drawing }) {
  const drawing = drawings[kind];
  return (
    <svg
      className="story-drawing"
      viewBox="0 0 220 185"
      fill="none"
      aria-hidden="true"
      focusable="false"
    >
      <g strokeLinecap="round" strokeLinejoin="round" strokeWidth="1.35">
        <g className="story-pencil-echo" transform="translate(1.4 0.8)">
          {drawing.lines.slice(0, 2).map((d) => (
            <path key={d} d={d} />
          ))}
        </g>
        {drawing.lines.map((d) => (
          <path className="story-pencil-path" pathLength="1" key={d} d={d} />
        ))}
        <g className="story-pencil-accent" strokeWidth="2">
          {drawing.accents.map((d) => (
            <path className="story-pencil-path" pathLength="1" key={d} d={d} />
          ))}
        </g>
      </g>
    </svg>
  );
}
