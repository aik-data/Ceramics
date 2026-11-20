// Sample data for demo mode (Cal High Ceramics setup).
const img = (n) => `img/demo/${n}.svg`;
const day = 86400000;
const iso = (offsetMs) => new Date(Date.now() + offsetMs).toISOString();
const dateOnly = (offsetDays) => new Date(Date.now() + offsetDays * day).toISOString().slice(0, 10);
const CREDIT = "a Cal High Ceramics 1 student";

export function seedDemo() {
  const pieces = [
    ["p1", "Speckled Seafoam Vase", CREDIT, "Wheel-thrown stoneware with a speckled seafoam glaze. Holds water — perfect for fresh flowers.", "Vases", 4000, 1, "speckled-vase"],
    ["p2", "Ocean Serving Bowl", CREDIT, "A wide bowl glazed in deep ocean blue, big enough for salad or fruit.", "Bowls", 3500, 1, "ocean-bowl"],
    ["p3", "Honey Glaze Mug", CREDIT, "Hand-built mugs in a warm honey glaze. Each is slightly different. Food safe.", "Mugs", 1500, 8, "honey-mug"],
    ["p4", "Sage Dessert Plate", CREDIT, "Soft sage green with a satin finish. A small plate for cookies or a candle.", "Plates", 2000, 1, "sage-plate"],
    ["p5", "Rose Bud Vase", CREDIT, "A slender bud vase in blush pink — sized for a single stem.", "Vases", 1800, 1, "rose-bud-vase"],
    ["p6", "Terracotta Planter", CREDIT, "Unglazed terracotta planter with a drainage hole.", "Planters", 2500, 1, "terracotta-planter"],
    ["p7", "Midnight Tumbler", CREDIT, "A tall tumbler in glossy midnight blue. Great for pens, brushes or iced tea.", "Mugs", 2000, 1, "midnight-tumbler"],
    ["p8", "Lidded Treasure Jar", CREDIT, "A small jar with a fitted lid, made for keepsakes.", "Jars & dishes", 3000, 1, "lidded-jar"],
    ["p9", "Celadon Pitcher", CREDIT, "A pouring pitcher with a pulled spout and a pale celadon glaze.", "Pitchers", 4500, 1, "celadon-pitcher"],
    ["p10", "Sunshine Ring Dish", CREDIT, "Little ring dishes in sunny yellow.", "Jars & dishes", 1000, 12, "ring-dish"],
    ["p11", "Cloud Bowl", CREDIT, "A matte white bowl with a soft, cloud-like rim.", "Bowls", 2500, 1, "cloud-bowl"],
    ["p12", "Forest Mug", CREDIT, "A sturdy mug in forest green with a comfortable thumb rest.", "Mugs", 2200, 1, "forest-mug"],
  ].map(([id, title, artist, description, category, suggested_cents, quantity, pic], i) => ({
    id, title, artist, description, category, suggested_cents, quantity, photos: [img(pic)], hidden: false, sort: i,
    created_at: iso(-10 * day + i * 1000),
  }));

  const pickupOptions = [
    { id: "pu1", label: "Pickup day", pickup_date: "2026-12-11", start_time: null, end_time: null, location: "Ceramics Yard, FA 102", note: "Before or after school", active: true, sort: 0 },
    { id: "pu2", label: "Pickup day", pickup_date: "2026-12-14", start_time: null, end_time: null, location: "Ceramics Yard, FA 102", note: "Before or after school", active: true, sort: 1 },
    { id: "pu3", label: "Pickup day", pickup_date: "2026-12-15", start_time: null, end_time: null, location: "Ceramics Yard, FA 102", note: "Before or after school", active: true, sort: 2 },
  ];

  const item = (p, qty = 1) => {
    const pc = pieces.find((x) => x.id === p);
    return { id: `oi-${p}-${Math.random().toString(36).slice(2, 7)}`, piece_id: p, qty, suggested_cents: pc.suggested_cents, title: pc.title, artist: pc.artist, released: false };
  };
  const base = { student_name: "", student_class: "", pickup_option_id: null, pickup_label: "", notes: "",
    invoice_sent_at: null, paid_at: null, amount_received_cents: null, released_at: null, picked_up_at: null };
  const orders = [
    { ...base, id: "o5", order_no: "CER-1005", created_at: iso(-0.05 * day), parent_name: "Jordan Kim", email: "jordan.kim@example.com", phone: "555-0142",
      status: "new", seen_at: null, notes: "Could the mug be gift wrapped?", order_items: [item("p3", 2), item("p5")] },
    { ...base, id: "o4", order_no: "CER-1004", created_at: iso(-0.6 * day), parent_name: "Priya Shah", email: "priya.shah@example.com", phone: "555-0177",
      status: "new", seen_at: null, order_items: [item("p10", 3)] },
    { ...base, id: "o3", order_no: "CER-1003", created_at: iso(-3.5 * day), parent_name: "Chris Morgan", email: "cmorgan@example.com", phone: "555-0110",
      status: "new", seen_at: iso(-3.4 * day), order_items: [item("p9")] },
    { ...base, id: "o2", order_no: "CER-1002", created_at: iso(-1.2 * day), parent_name: "Dana Lopez", email: "dana.lopez@example.com", phone: "555-0199",
      status: "new", seen_at: iso(-1.1 * day), order_items: [item("p2")] },
    { ...base, id: "o1", order_no: "CER-1001", created_at: iso(-5 * day), parent_name: "Sam Rivera", email: "sam.rivera@example.com", phone: "555-0123",
      status: "paid", seen_at: iso(-4.9 * day), paid_at: iso(-4 * day), picked_up_at: iso(-1 * day), amount_received_cents: 6000, order_items: [item("p1"), item("p3")] },
  ];

  return {
    settings: {
      fundraiser_name: "California High School Ceramics",
      school_name: "Student Ceramics Sale",
      intro: "Every piece in this gallery was handcrafted by a Cal High Ceramics 1 student. Reserve your favorites here, donate the suggested amount on FutureFund, and pick them up at school.",
      instructions: "Once you have reserved your item, go to this link {link} and donate the suggested amount. Save your receipt — you will need it to pick up your item before or after school on {pickup_days}.",
      goal_cents: 250000,
      sale_opens_at: iso(-2 * day),
      sale_closes_at: iso(14 * day),
      checkout_paused: false,
      overdue_hours: 48,
      donate_url: "https://www.futurefund.com/",
      notify_emails: ["admin@example.org"],
      expenses_cents: 0,
    },
    familyPassword: null,
    nextOrderNo: 1006,
    pieces,
    pickupOptions,
    orders,
    donations: [
      { id: "d1", amount_cents: 5000, donated_on: dateOnly(-3), name: "The Okafor family", note: "", created_at: iso(-3 * day) },
      { id: "d2", amount_cents: 2500, donated_on: dateOnly(-1), name: "", note: "Anonymous", created_at: iso(-1 * day) },
    ],
    activity: [
      { id: "a0", at: iso(-1 * day), admin_email: "admin@example.org", order_id: "o1", action: "Picked up", detail: "" },
      { id: "a1", at: iso(-4 * day), admin_email: "admin@example.org", order_id: "o1", action: "Marked paid", detail: "" },
      { id: "a2", at: iso(-0.9 * day), admin_email: "admin@example.org", order_id: "o2", action: "Marked paid", detail: "" },
    ],
    admins: [{ user_id: "demo-admin", email: "admin@example.org", created_at: iso(-10 * day) }],
  };
}
