// Preloaded icons for item groups, per kind of business.
// New groups get an icon from their name automatically; owners can pick another.
// Only widely supported emoji (Android 8+ / iOS 12+) are used.

const CLOTHES = [
  ['👖', 'pallazo palazzo trouser pant jean jeans khaki chino legging jogger'],
  ['👚', 'top crop blouse tunic camisole cami'],
  ['👕', 't-shirt tshirt tee shirt polo'],
  ['🩱', 'body suit bodysuit swimsuit one-piece leotard'],
  ['🧥', 'jacket coat blazer hoodie sweater sweatshirt cardigan trench puffer'],
  ['👗', 'dress gown maxi midi frock'],
  ['🩳', 'short shorts'],
  ['👙', 'bikini lingerie bra'],
  ['🩲', 'underwear brief boxer panty panties'],
  ['🥻', 'kitenge sari saree wrapper leso kanga'],
  ['👘', 'kimono robe kaftan abaya dera'],
  ['🎽', 'vest tank sleeveless jersey sports gym'],
  ['🧣', 'scarf shawl'],
  ['🧤', 'glove gloves'],
  ['🧢', 'cap'],
  ['👒', 'hat'],
  ['🧦', 'sock socks stocking tights'],
  ['👟', 'sneaker sneakers trainer trainers rubber shoe shoes'],
  ['👠', 'heel heels stiletto'],
  ['👡', 'sandal sandals slipper slippers'],
  ['👢', 'boot boots'],
  ['🥿', 'flat flats loafer loafers ballerina'],
  ['👜', 'handbag bag tote'],
  ['👛', 'purse wallet clutch'],
  ['🎒', 'backpack school'],
  ['👶', 'baby kids kid children child toddler'],
  ['🛏️', 'bedding duvet sheet sheets curtain curtains'],
];

const JEWELLERY = [
  ['💍', 'ring rings band'],
  ['💎', 'earring earrings stud studs diamond hoop hoops'],
  ['📿', 'necklace necklaces bead beads rosary choker pendant'],
  ['🔗', 'chain chains bracelet bracelets anklet anklets bangle bangles'],
  ['⌚', 'watch watches'],
  ['👑', 'tiara crown'],
  ['🎀', 'hair bow bows clip clips band bands scrunchie'],
  ['🕶️', 'sunglass sunglasses glasses shades'],
  ['🧿', 'charm charms evil eye'],
  ['🌸', 'brooch brooches flower'],
  ['✨', 'set sets gift collection'],
  ['👜', 'bag bags'],
  ['👛', 'purse wallet'],
  ['🎁', 'gift box boxes'],
];

export const iconsFor = (kind) => (kind === 'pieces' ? JEWELLERY : CLOTHES).map(([i]) => i);

/** Best icon for a new item group's name ("Crop tops" → 👚, "Earrings" → 💎). */
export function suggestIcon(name, kind) {
  const words = String(name || '').toLowerCase().replace(/[^a-z\s-]/g, ' ').split(/\s+/).filter(Boolean);
  const lists = kind === 'pieces' ? [JEWELLERY, CLOTHES] : [CLOTHES, JEWELLERY];
  for (const list of lists) {
    for (const w of words.slice().reverse()) {        // last word usually names the thing ("crop TOPS")
      const stem = w.replace(/e?s$/, '');
      for (const [icon, keys] of list) {
        const ks = keys.split(' ');
        if (ks.includes(w) || ks.includes(stem) || ks.some((k) => k.length > 3 && (w.startsWith(k) || k.startsWith(stem)))) return icon;
      }
    }
  }
  return kind === 'pieces' ? '💍' : '👕';
}
