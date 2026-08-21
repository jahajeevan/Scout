"use client";

// ═══════════════════════════════════════════════════════════════════════════
// EmojiPicker — self-contained, no external library. ~200 curated emojis
// grouped by category. Click to fire onPick(emoji). Recent picks pinned to
// the top via localStorage. Popover parent handles positioning + open/close.
// ═══════════════════════════════════════════════════════════════════════════

import { useEffect, useMemo, useState } from "react";

const CATEGORIES: { name: string; icon: string; emojis: string[] }[] = [
  {
    name: "Smileys",
    icon: "😀",
    emojis: [
      "😀","😃","😄","😁","😆","😅","🤣","😂","🙂","🙃","😉","😊","😇","🥰","😍","🤩",
      "😘","😗","☺️","😚","😙","🥲","😋","😛","😜","🤪","😝","🤑","🤗","🤭","🤫","🤔",
      "🫡","🤨","😐","😑","😶","🫥","😏","😒","🙄","😬","🤥","😌","😔","😴","🤤","😪",
      "😷","🤒","🤕","🤢","🤮","🤧","🥵","🥶","🥴","😵","🤯","🤠","🥳","🥸","😎","🤓",
      "🧐","😕","🫤","😟","🙁","☹️","😮","😯","😲","😳","🥺","🥹","😦","😧","😨","😰",
      "😥","😢","😭","😱","😖","😣","😞","😓","😩","😫","🥱","😤","😡","😠","🤬","😈",
      "👿","💀","☠️","💩","🤡","👻","👽","👾","🤖","😺","😸","😹","😻","😼","😽","🙀",
      "😿","😾",
    ],
  },
  {
    name: "Gestures",
    icon: "👍",
    emojis: [
      "👋","🤚","🖐️","✋","🖖","🫱","🫲","🫳","🫴","🫰","🤌","🤏","✌️","🤞","🫰","🤟",
      "🤘","🤙","👈","👉","👆","🖕","👇","☝️","👍","👎","✊","👊","🤛","🤜","👏","🙌",
      "🫶","👐","🤲","🤝","🙏","✍️","💪","🦾","🦿","🦵","🦶","👂","🦻","👃","🧠","🫀",
      "🫁","🦷","🦴","👀","👁️","👅","👄","🫦","💋","🩸",
    ],
  },
  {
    name: "Hearts",
    icon: "❤️",
    emojis: [
      "❤️","🧡","💛","💚","💙","💜","🤎","🖤","🤍","💔","❣️","💕","💞","💓","💗","💖",
      "💘","💝","💟","☮️","✝️","☪️","🕉️","☸️","✡️","🔯","🕎","☯️","☦️","🛐","⛎","♈",
    ],
  },
  {
    name: "Nature",
    icon: "🌸",
    emojis: [
      "🌸","💮","🏵️","🌹","🥀","🌺","🌻","🌼","🌷","🌱","🪴","🌲","🌳","🌴","🌵","🌾",
      "🌿","☘️","🍀","🍁","🍂","🍃","🍄","🌰","🦀","🦞","🦐","🦑","🐙","🦕","🦖","🐳",
      "🐋","🐬","🦭","🐟","🐠","🐡","🦈","🐊","🐆","🐅","🐃","🐂","🐄","🦌","🦬","🐪",
      "🐫","🦙","🦒","🐘","🦣","🦏","🦛","🐎","🐖","🐏","🐑","🐐","🦔","🦇","🐻","🐨",
      "🐼","🦥","🦦","🦨","🦘","🦡","🐕","🐩","🐈","🐓","🦃","🦤","🦚","🦜","🦢","🕊️",
      "🐇","🦝","🦡","🐁","🐀","🐿️","🦎",
    ],
  },
  {
    name: "Food",
    icon: "🍕",
    emojis: [
      "🍇","🍈","🍉","🍊","🍋","🍌","🍍","🥭","🍎","🍏","🍐","🍑","🍒","🍓","🫐","🥝",
      "🍅","🫒","🥥","🥑","🍆","🥔","🥕","🌽","🌶️","🫑","🥒","🥬","🥦","🧄","🧅","🍄",
      "🥜","🌰","🍞","🥐","🥖","🫓","🥨","🥯","🥞","🧇","🧀","🍖","🍗","🥩","🥓","🍔",
      "🍟","🍕","🌭","🥪","🌮","🌯","🫔","🥙","🧆","🥚","🍳","🥘","🍲","🫕","🥣","🥗",
      "🍿","🧈","🧂","🥫","🍱","🍘","🍙","🍚","🍛","🍜","🍝","🍠","🍢","🍣","🍤","🍥",
      "🥮","🍡","🥟","🥠","🥡","🍦","🍧","🍨","🍩","🍪","🎂","🍰","🧁","🥧","🍫","🍬",
      "🍭","🍮","🍯","🍼","🥛","☕","🫖","🍵","🍶","🍾","🍷","🍸","🍹","🍺","🍻","🥂",
      "🥃","🫗","🥤","🧋","🧃","🧉","🧊",
    ],
  },
  {
    name: "Activities",
    icon: "🎯",
    emojis: [
      "⚽","🏀","🏈","⚾","🥎","🎾","🏐","🏉","🥏","🎱","🪀","🏓","🏸","🏒","🏑","🥍",
      "🏏","🪃","🥅","⛳","🪁","🏹","🎣","🤿","🥊","🥋","🎽","🛹","🛼","🛷","⛸️","🥌",
      "🎿","⛷️","🏂","🪂","🏋️","🤼","🤸","🤺","⛹️","🤾","🏌️","🏇","🧘","🏄","🏊","🤽",
      "🚣","🧗","🚵","🚴","🏆","🥇","🥈","🥉","🏅","🎖️","🏵️","🎗️","🎫","🎟️","🎪","🤹",
      "🎭","🩰","🎨","🎬","🎤","🎧","🎼","🎹","🥁","🪘","🎷","🎺","🎸","🪕","🎻","🎲",
      "♟️","🎯","🎳","🎮","🎰","🧩",
    ],
  },
  {
    name: "Objects",
    icon: "💻",
    emojis: [
      "💻","⌨️","🖥️","🖨️","🖱️","🖲️","💽","💾","💿","📀","📼","📷","📸","📹","🎥","📽️",
      "🎞️","📞","☎️","📟","📠","📺","📻","🎙️","🎚️","🎛️","🧭","⏱️","⏲️","⏰","🕰️","⌛",
      "⏳","📡","🔋","🪫","🔌","💡","🔦","🕯️","🪔","🧯","🛢️","💸","💵","💴","💶","💷",
      "🪙","💰","💳","💎","⚖️","🪜","🧰","🪛","🔧","🔨","⚒️","🛠️","⛏️","🪚","🔩","⚙️",
      "🪤","🧱","⛓️","🧲","🔫","💣","🧨","🪓","🗡️","⚔️","🛡️","🚬","⚰️","🪦","⚱️","🏺",
      "🔮","📿","🧿","🪬","💈","⚗️","🔭","🔬","🕳️","🩹","🩺","💊","💉","🩸","🧬","🦠",
      "🧫","🧪","🌡️","🧹","🪠","🧺","🧻","🚽","🚰","🚿","🛁","🛀","🧼","🪥","🪒","🧽",
      "🪣","🧴","🛎️","🔑","🗝️","🚪","🪑","🛋️","🛏️","🛌","🧸","🪆","🖼️","🪞","🪟","🛍️",
      "🛒","🎁","🎈","🎏","🎀","🪄","🪅","🎊","🎉","🎎","🏮","🎐","🧧","✉️","📩","📨",
      "📧","💌","📥","📤","📦","🏷️","🪧","📪","📫","📬","📭","📮","📯","📜","📃","📄",
      "📑","🧾","📊","📈","📉","🗒️","🗓️","📆","📅","🗑️","📇","🗃️","🗳️","🗄️","📋","📁",
      "📂","🗂️","🗞️","📰","📓","📔","📒","📕","📗","📘","📙","📚","📖","🔖","🧷","🔗",
      "📎","🖇️","📐","📏","🧮","📌","📍","✂️","🖊️","🖋️","✒️","🖌️","🖍️","📝","✏️","🔍",
      "🔎","🔏","🔐","🔒","🔓",
    ],
  },
  {
    name: "Symbols",
    icon: "✨",
    emojis: [
      "✨","🌟","⭐","🌠","☄️","💫","🔥","🌈","🎇","🎆","🌌","🌙","⚡","☀️","☁️","⛅",
      "⛈️","🌤️","🌥️","🌦️","🌧️","🌨️","🌩️","🌪️","🌫️","🌬️","💨","💧","💦","☔","🌊","🌵",
      "🎄","🌲","🌳","🌴","🪵","💯","💢","💥","💫","💦","💨","🕳️","💬","👁️‍🗨️","🗨️","🗯️",
      "💭","💤","🌐","♨️","🛑","🚸","⛔","📛","🚫","💯","💢","♻️","⚜️","🔱","📛","🔰",
      "⭕","✅","☑️","✔️","❌","❎","➕","➖","➗","✖️","🟰","♾️","💲","💱","™️","©️","®️",
    ],
  },
];

const ALL_EMOJI = CATEGORIES.flatMap((c) => c.emojis);
const RECENT_KEY = "scout-emoji-recent";
const RECENT_MAX = 24;

function loadRecent(): string[] {
  try {
    const raw = localStorage.getItem(RECENT_KEY);
    return raw ? JSON.parse(raw) : [];
  } catch {
    return [];
  }
}
function saveRecent(list: string[]): void {
  try {
    localStorage.setItem(RECENT_KEY, JSON.stringify(list.slice(0, RECENT_MAX)));
  } catch {}
}

export default function EmojiPicker({
  onPick,
  onClose,
}: {
  onPick: (emoji: string) => void;
  onClose: () => void;
}): JSX.Element {
  const [tab, setTab] = useState<string>("recent");
  const [query, setQuery] = useState<string>("");
  const [recent, setRecent] = useState<string[]>(() => loadRecent());

  useEffect(() => { saveRecent(recent); }, [recent]);

  const pick = (e: string): void => {
    onPick(e);
    setRecent((prev) => {
      const dedup = [e, ...prev.filter((x) => x !== e)];
      return dedup.slice(0, RECENT_MAX);
    });
  };

  const displayed = useMemo(() => {
    if (query.trim()) {
      // No proper emoji names bundled; fall back to searching ALL
      // by contains. Cheap but works for keyword prefixes we baked in
      // (nothing else needed for MVP).
      const q = query.trim().toLowerCase();
      return ALL_EMOJI.filter((e) => e.includes(q));
    }
    if (tab === "recent") return recent.length ? recent : CATEGORIES[0].emojis.slice(0, 40);
    const cat = CATEGORIES.find((c) => c.name.toLowerCase() === tab);
    return cat ? cat.emojis : ALL_EMOJI;
  }, [tab, query, recent]);

  return (
    <div className="emoji-pop" onClick={(e) => e.stopPropagation()}>
      <div className="emoji-tabs">
        <button
          className={`emoji-tab ${tab === "recent" && !query ? "active" : ""}`}
          onClick={() => { setTab("recent"); setQuery(""); }}
          title="Recent"
        >
          🕘
        </button>
        {CATEGORIES.map((c) => (
          <button
            key={c.name}
            className={`emoji-tab ${tab === c.name.toLowerCase() && !query ? "active" : ""}`}
            onClick={() => { setTab(c.name.toLowerCase()); setQuery(""); }}
            title={c.name}
          >
            {c.icon}
          </button>
        ))}
      </div>
      <input
        className="emoji-search"
        placeholder="Search emoji…"
        value={query}
        onChange={(e) => setQuery(e.target.value)}
        autoFocus
      />
      <div className="emoji-grid">
        {displayed.length === 0 ? (
          <div className="emoji-empty">No matches</div>
        ) : (
          displayed.map((e, i) => (
            <button
              key={`${e}-${i}`}
              className="emoji-cell"
              onClick={() => pick(e)}
              title={e}
              type="button"
            >
              {e}
            </button>
          ))
        )}
      </div>
    </div>
  );
}
