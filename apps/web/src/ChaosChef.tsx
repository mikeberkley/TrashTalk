export function ChaosChef() {
  return (
    <div
      className="chaos-kitchen"
      role="img"
      aria-label="A panicked chef wrestles an out-of-control mixer, launches a ridiculous cake, and gets splattered with frosting"
    >
      <svg viewBox="0 -65 360 320" aria-hidden="true">
        <defs>
          <linearGradient id="bowl-shine" x2="1" y2="1">
            <stop stopColor="#d8e1ed" />
            <stop offset="1" stopColor="#77899f" />
          </linearGradient>
        </defs>
        <g className="kitchen-burst" fill="#ccff66" opacity=".15">
          <path d="M239 150 L171 -32 L219 41 L246 -51 L267 42 L337 -22 L304 75 L358 84 L303 124 L347 179Z" />
        </g>
        <ellipse cx="180" cy="229" rx="146" ry="12" fill="#000" opacity=".22" />
        <g
          className="chef-bounce"
          stroke="#171b25"
          strokeWidth="4"
          strokeLinejoin="round"
        >
          <path d="M62 204 Q54 132 102 130 Q146 130 151 204Z" fill="#fff4dd" />
          <path d="M76 150 L88 203 H129 L133 150" fill="#f77eaa" />
          <path d="M80 159 L102 176 L91 187" fill="none" stroke="#db4e79" />
          <circle cx="108" cy="112" r="30" fill="#ffc28d" />
          <g className="chef-hat">
            <path
              d="M78 102 Q56 79 78 68 Q62 39 88 37 Q99 4 123 32 Q155 17 158 48 Q184 65 145 84 L142 98Z"
              fill="#fff"
            />
            <path d="M79 93 L143 88 L145 99 L80 106Z" fill="#fff4dd" />
            <path
              d="M98 55 l4 25 M126 50 l-2 26"
              stroke="#ccd4df"
              strokeWidth="3"
            />
          </g>
          <g fill="#fff">
            <ellipse cx="94" cy="112" rx="12" ry="14" />
            <ellipse cx="122" cy="107" rx="12" ry="15" />
          </g>
          <g className="chef-pupils" fill="#171b25" stroke="none">
            <circle cx="99" cy="112" r="5" />
            <circle cx="128" cy="108" r="5" />
          </g>
          <path
            d="M81 94 l15 -7 M115 87 l16 3"
            fill="none"
            strokeLinecap="round"
          />
          <ellipse cx="112" cy="139" rx="9" ry="12" fill="#512e3d" />
          <path d="M108 143 l8 0" stroke="#ff88a9" strokeWidth="5" />
          <ellipse
            cx="107"
            cy="119"
            rx="8"
            ry="5"
            fill="#ec9a68"
            stroke="none"
          />
          <path
            d="M95 129 Q107 118 113 128 Q125 118 134 126 Q117 141 95 129"
            fill="#5b3440"
          />
          <path d="M101 143 L111 151 L123 142" fill="#ccff66" />
          <g className="chef-arm">
            <path
              d="M133 147 Q155 117 183 137"
              fill="none"
              stroke="#fff4dd"
              strokeWidth="18"
            />
            <circle cx="185" cy="138" r="10" fill="#ffc28d" />
            <path d="M182 141 L209 169" stroke="#f6cb69" strokeWidth="8" />
          </g>
          <path
            d="M66 154 Q44 174 65 183"
            fill="none"
            stroke="#fff4dd"
            strokeWidth="15"
          />
          <path
            d="M85 185 l5 4 m27 -22 l5 3 M120 65 l8 3"
            stroke="#b3906b"
            strokeWidth="6"
            strokeLinecap="round"
          />
        </g>
        <g
          className="mixer-rattle"
          stroke="#171b25"
          strokeWidth="4"
          strokeLinejoin="round"
        >
          <path
            d="M288 112 Q328 115 324 209 H295 L290 150 H248 V120Z"
            fill="#f77eaa"
          />
          <path
            d="M212 112 H297 Q313 112 312 131 Q312 144 294 144 H206 Q193 124 212 112Z"
            fill="#ccff66"
          />
          <path d="M245 142 V167" stroke="#d8e1ed" strokeWidth="8" />
          <g className="mixer-whisk">
            <path
              d="M233 159 Q220 194 245 194 Q270 194 257 159 M245 159 V195"
              fill="none"
              stroke="#d8e1ed"
              strokeWidth="3"
            />
          </g>
          <path
            d="M185 174 Q182 216 219 221 H265 Q299 213 297 174Z"
            fill="url(#bowl-shine)"
          />
          <ellipse cx="241" cy="174" rx="56" ry="12" fill="#f4ca81" />
          <path
            className="batter-swirl"
            d="M210 173 Q229 163 271 174 Q250 184 230 175"
            fill="none"
            stroke="#b87743"
            strokeWidth="3"
          />
          <path d="M186 223 H326 V232 H181Z" fill="#f77eaa" />
          <circle cx="293" cy="128" r="5" fill="#171b25" stroke="none" />
        </g>
        <g
          className="flying-cake"
          stroke="#171b25"
          strokeWidth="3"
          strokeLinejoin="round"
        >
          <path
            d="M211 130 l-5 22 15 -12 7 27 8 -25 17 18 1 -26"
            fill="#ffda65"
            stroke="none"
          />
          <path d="M201 109 H277 V133 Q239 142 201 133Z" fill="#ff91bc" />
          <path
            d="M200 106 Q208 96 216 105 Q225 93 236 104 Q246 92 257 105 Q270 95 279 106 V117 Q271 124 266 113 Q254 109 251 122 Q244 130 239 114 Q226 109 221 122 Q215 130 211 115 L200 116Z"
            fill="#fff4dd"
          />
          <path d="M215 88 H264 V106 H215Z" fill="#f4ca81" />
          <path
            d="M213 86 Q225 74 236 84 Q251 70 266 85 L264 94 Q257 103 251 89 Q243 92 239 100 Q232 102 231 90 Q217 99 213 86"
            fill="#ccff66"
          />
          <path d="M239 65 V82" stroke="#f77eaa" strokeWidth="6" />
          <path d="M239 65 Q226 57 240 46 Q254 60 239 65" fill="#ffda65" />
          <path d="M216 127 l5 -2 m12 7 l5 -3 m19 -3 l5 2" stroke="#c5447c" />
        </g>
        <g
          className="chef-frosting"
          fill="#ff91bc"
          stroke="#171b25"
          strokeWidth="2"
        >
          <path d="M78 99 Q91 90 101 100 Q113 92 124 102 Q141 96 140 111 Q128 114 125 130 Q118 139 115 116 Q105 111 102 131 Q94 139 92 115 Q77 122 78 99Z" />
          <circle cx="71" cy="133" r="5" />
          <circle cx="141" cy="152" r="6" />
        </g>
        <g
          className="chef-sweat"
          fill="#78dbff"
          stroke="#171b25"
          strokeWidth="2"
        >
          <path d="M62 99 Q44 103 48 114 Q62 122 62 99Z" />
          <path d="M153 102 Q168 91 171 106 Q167 117 153 102Z" />
        </g>
        <g className="comic-boom">
          <text x="244" y="-23" textAnchor="middle">
            CAKE-QUAKE!
          </text>
        </g>
        <g className="comic-verdict">
          <text x="97" y="37" textAnchor="middle">
            NAILED IT.
          </text>
        </g>
        <g className="ingredient ingredient-egg">
          <ellipse
            cx="180"
            cy="72"
            rx="10"
            ry="14"
            fill="#fff4dd"
            stroke="#171b25"
            strokeWidth="3"
          />
          <path
            d="M172 73 l6 -3 4 6 6 -3"
            fill="none"
            stroke="#b3906b"
            strokeWidth="2"
          />
        </g>
        <g className="ingredient ingredient-flour">
          <path
            d="M264 45 L291 49 L287 80 L259 76Z"
            fill="#fff4dd"
            stroke="#171b25"
            strokeWidth="3"
          />
          <path
            d="M267 57 l16 2 m-17 7 l10 1"
            stroke="#f77eaa"
            strokeWidth="5"
          />
        </g>
        <g className="ingredient ingredient-butter">
          <path
            d="M319 78 l20 5 -4 13 -20 -5Z"
            fill="#ffdf65"
            stroke="#171b25"
            strokeWidth="3"
          />
        </g>
        <g
          className="rogue-duck"
          stroke="#171b25"
          strokeWidth="2.5"
          strokeLinejoin="round"
        >
          <path
            d="M299 66 Q288 48 303 45 Q320 42 319 59 L329 64 Q325 82 307 79 Q293 76 290 64Z"
            fill="#ffda65"
          />
          <path d="M316 54 l14 4 -13 5" fill="#ff9865" />
          <circle cx="309" cy="53" r="2" fill="#171b25" stroke="none" />
        </g>
        <g className="flour-puff" fill="#fff4dd" opacity=".65">
          <circle cx="218" cy="145" r="9" />
          <circle cx="229" cy="135" r="12" />
          <circle cx="241" cy="145" r="8" />
        </g>
        <g className="batter-splatter" fill="#f4ca81">
          <circle cx="168" cy="151" r="5" />
          <circle cx="309" cy="161" r="4" />
          <circle cx="280" cy="103" r="3" />
          <path d="M180 198 q-14 -16 -12 -4 q3 9 12 4" />
        </g>
        <g stroke="#ccff66" strokeWidth="3" strokeLinecap="round">
          <path
            className="kitchen-zap"
            d="M39 104 l-8 -7 m10 20 -13 2 M337 136 l10 -7 m-8 22 12 3"
          />
        </g>
      </svg>
      <div className="kitchen-progress" aria-hidden="true">
        <div className="kitchen-progress-fill" />
      </div>
    </div>
  );
}
