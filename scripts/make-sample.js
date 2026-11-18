// Generates the "Naija Mart" sample database (fictional data) used by the
// lessons. Deterministic: the same seed always produces the same rows.
//   node scripts/make-sample.js
import { writeFileSync } from 'node:fs';

let seed = 20261118;
const rand = () => ((seed = (seed * 1664525 + 1013904223) % 4294967296) / 4294967296);
const pick = (a) => a[Math.floor(rand() * a.length)];
const int = (lo, hi) => lo + Math.floor(rand() * (hi - lo + 1));
const round2 = (n) => Math.round(n * 100) / 100;
const pad = (n) => String(n).padStart(2, '0');
const day = (start, end) => {
  const a = Date.UTC(...start), b = Date.UTC(...end);
  const d = new Date(a + rand() * (b - a));
  return `${d.getUTCFullYear()}-${pad(d.getUTCMonth() + 1)}-${pad(d.getUTCDate())}`;
};

const firstNames = ['Adaeze', 'Chinedu', 'Ngozi', 'Emeka', 'Funmilayo', 'Tunde', 'Aisha', 'Ibrahim', 'Bolanle', 'Obinna', 'Zainab', 'Segun', 'Chiamaka', 'Musa', 'Yetunde', 'Ifeanyi', 'Hauwa', 'Kelechi', 'Folake', 'Usman', 'Amaka', 'Babatunde', 'Halima', 'Uchenna', 'Temitope', 'Abdullahi', 'Nkechi', 'Olumide', 'Fatima', 'Chukwudi', 'Bisola', 'Sani', 'Ebere', 'Kunle', 'Maryam', 'Nnamdi', 'Damilola', 'Aliyu', 'Ifeoma', 'Gbenga'];
const lastNames = ['Okafor', 'Adeyemi', 'Okonkwo', 'Bello', 'Eze', 'Balogun', 'Okeke', 'Abubakar', 'Adebayo', 'Nwosu', 'Ibrahim', 'Ogunleye', 'Okoro', 'Danjuma', 'Afolabi', 'Chukwu', 'Yusuf', 'Obi', 'Olawale', 'Okoye', 'Lawal', 'Nwachukwu', 'Ogundipe', 'Mohammed', 'Uzor', 'Akinola', 'Okpara', 'Suleiman', 'Ekwueme', 'Oyelaran'];
const places = [
  ['Lagos', 'Lagos', 18], ['Ikeja', 'Lagos', 8], ['Lekki', 'Lagos', 6], ['Abuja', 'FCT', 12], ['Port Harcourt', 'Rivers', 8],
  ['Ibadan', 'Oyo', 7], ['Kano', 'Kano', 6], ['Enugu', 'Enugu', 6], ['Benin City', 'Edo', 5], ['Kaduna', 'Kaduna', 4],
  ['Owerri', 'Imo', 4], ['Abeokuta', 'Ogun', 4], ['Jos', 'Plateau', 3], ['Uyo', 'Akwa Ibom', 3], ['Calabar', 'Cross River', 3],
  ['Ilorin', 'Kwara', 3],
];
const weightedPlace = () => {
  const total = places.reduce((s, p) => s + p[2], 0);
  let r = rand() * total;
  for (const p of places) if ((r -= p[2]) < 0) return p;
  return places[0];
};

/* ---------- customers ---------- */
const customers = [];
for (let id = 1; id <= 120; id++) {
  const fn = pick(firstNames), ln = pick(lastNames);
  const [city, state] = weightedPlace();
  const email = rand() < 0.08 ? null : `${fn}.${ln}${id}@example.com`.toLowerCase();
  customers.push([id, fn, ln, email, city, state, day([2023, 0, 1], [2025, 5, 30]), rand() < 0.2]);
}

/* ---------- products (prices in naira) ---------- */
const catalogue = {
  Phones: [['Tecno Spark 20', 145000], ['Infinix Hot 40', 168000], ['Samsung Galaxy A15', 215000], ['iPhone 13 (refurbished)', 620000], ['Itel A70', 89000], ['Redmi Note 13', 255000], ['Tecno Camon 30', 310000]],
  Computers: [['HP 250 G9 Laptop', 540000], ['Lenovo IdeaPad 3', 610000], ['Dell Latitude (refurbished)', 380000], ['MacBook Air M2', 1450000], ['Wireless Mouse', 9500], ['USB-C Hub', 18500]],
  'Home Appliances': [['Binatone Blender', 42000], ['Thermocool Freezer 200L', 398000], ['Haier Thermocool AC 1.5HP', 455000], ['Scanfrost Gas Cooker', 265000], ['Electric Kettle', 16500], ['Standing Fan 18"', 38000]],
  Fashion: [['Ankara Fabric (6 yards)', 18000], ['Aso Oke Set', 65000], ["Men's Kaftan", 35000], ['Leather Sandals', 22000], ['Headwrap (Gele)', 12000], ['Agbada Set', 85000]],
  Groceries: [['Rice 50kg Bag', 78000], ['Garri (Ijebu) 10kg', 12500], ['Palm Oil 5L', 14500], ['Semovita 10kg', 16000], ['Indomie Carton (40)', 13800], ['Tomato Paste Carton', 21000], ['Beans (Oloyin) 10kg', 24000]],
  Beauty: [['Shea Butter 500g', 6500], ['Black Soap', 3500], ['Body Lotion 400ml', 7800], ['Perfume 100ml', 28000], ['Hair Extensions', 45000]],
  Books: [['Things Fall Apart', 6500], ['Half of a Yellow Sun', 9500], ['Purple Hibiscus', 8000], ['Learn SQL in a Weekend', 12000], ['WAEC Past Questions (Maths)', 4500]],
};
const products = [];
let pid = 1;
for (const [category, items] of Object.entries(catalogue)) {
  for (const [name, price] of items) products.push([pid++, name, category, price, int(0, 250)]);
}
const neverOrdered = new Set([products[3][0], products[16][0], products[35][0]]); // a few products nobody buys

/* ---------- orders, items, payments ---------- */
const orders = [], items = [], payments = [];
const inactive = new Set(customers.filter(() => rand() < 0.12).map((c) => c[0]));
let oid = 1, iid = 1, payid = 1;
for (let n = 0; n < 650; n++) {
  let c;
  do c = pick(customers); while (inactive.has(c[0]));
  const date = day([2024, 0, 1], [2025, 9, 31]);
  const status = (() => { const r = rand(); return r < 0.72 ? 'delivered' : r < 0.84 ? 'shipped' : r < 0.93 ? 'pending' : 'cancelled'; })();
  const fee = c[5] === 'Lagos' ? pick([1500, 2000, 2500]) : pick([3000, 3500, 4500, 5000]);
  orders.push([oid, c[0], date, status, fee]);
  let total = fee;
  const lines = int(1, 4);
  const used = new Set();
  for (let k = 0; k < lines; k++) {
    let p;
    do p = pick(products); while (neverOrdered.has(p[0]) || used.has(p[0]));
    used.add(p[0]);
    const qty = p[3] > 200000 ? 1 : int(1, p[3] < 20000 ? 5 : 2);
    // Some sales happened at a discount, so line prices can differ from the list price.
    const unit = rand() < 0.15 ? round2(p[3] * 0.9) : p[3];
    items.push([iid++, oid, p[0], qty, unit]);
    total += qty * unit;
  }
  if (status !== 'pending' && status !== 'cancelled') {
    const method = pick(['card', 'card', 'bank_transfer', 'bank_transfer', 'ussd', 'pay_on_delivery']);
    payments.push([payid++, oid, method, round2(total), `${date} ${pad(int(7, 22))}:${pad(int(0, 59))}:${pad(int(0, 59))}`]);
  }
  oid++;
}

const sample = {
  id: 'naija-mart',
  name: 'Naija Mart',
  description: 'A fictional Nigerian online store: customers, products, orders, order items and payments. All names and data are made up.',
  tables: [
    {
      name: 'customers',
      columns: [
        { name: 'customer_id', type: 'integer', pk: true },
        { name: 'first_name', type: 'text', notNull: true },
        { name: 'last_name', type: 'text', notNull: true },
        { name: 'email', type: 'text' },
        { name: 'city', type: 'text' },
        { name: 'state', type: 'text' },
        { name: 'signup_date', type: 'date' },
        { name: 'is_premium', type: 'boolean' },
      ],
      rows: customers,
    },
    {
      name: 'products',
      columns: [
        { name: 'product_id', type: 'integer', pk: true },
        { name: 'name', type: 'text', notNull: true },
        { name: 'category', type: 'text' },
        { name: 'unit_price', type: 'decimal' },
        { name: 'stock', type: 'integer' },
      ],
      rows: products,
    },
    {
      name: 'orders',
      columns: [
        { name: 'order_id', type: 'integer', pk: true },
        { name: 'customer_id', type: 'integer', notNull: true, references: { table: 'customers', column: 'customer_id' } },
        { name: 'order_date', type: 'date' },
        { name: 'status', type: 'text' },
        { name: 'delivery_fee', type: 'decimal' },
      ],
      rows: orders,
    },
    {
      name: 'order_items',
      columns: [
        { name: 'order_item_id', type: 'integer', pk: true },
        { name: 'order_id', type: 'integer', notNull: true, references: { table: 'orders', column: 'order_id' } },
        { name: 'product_id', type: 'integer', notNull: true, references: { table: 'products', column: 'product_id' } },
        { name: 'quantity', type: 'integer' },
        { name: 'unit_price', type: 'decimal' },
      ],
      rows: items,
    },
    {
      name: 'payments',
      columns: [
        { name: 'payment_id', type: 'integer', pk: true },
        { name: 'order_id', type: 'integer', notNull: true, references: { table: 'orders', column: 'order_id' } },
        { name: 'method', type: 'text' },
        { name: 'amount', type: 'decimal' },
        { name: 'paid_at', type: 'timestamp' },
      ],
      rows: payments,
    },
  ],
};

writeFileSync('src/lessons/naija-mart.json', JSON.stringify(sample));
console.log(sample.tables.map((t) => `${t.name}: ${t.rows.length}`).join(', '));
