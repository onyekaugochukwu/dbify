// Exercises for the Naija Mart sample database. Every solution is written in
// SQL that runs unchanged on SQLite, DuckDB and PostgreSQL.

export interface Exercise {
  id: string;
  level: 'Basics' | 'Filtering' | 'Aggregates' | 'Joins' | 'Advanced' | 'Changing data';
  title: string;
  prompt: string;
  hint: string;
  solution: string;
  /** Exercises that change data can't be auto-checked. */
  checkable?: boolean;
}

export const exercises: Exercise[] = [
  {
    id: 'select-all',
    level: 'Basics',
    title: 'Look at everything',
    prompt: 'Show every column and every row of the products table.',
    hint: 'SELECT * means "all columns".',
    solution: 'SELECT * FROM products;',
  },
  {
    id: 'select-columns',
    level: 'Basics',
    title: 'Pick columns',
    prompt: 'Show only the name and unit_price of every product.',
    hint: 'List the columns after SELECT, separated by commas.',
    solution: 'SELECT name, unit_price FROM products;',
  },
  {
    id: 'order-limit',
    level: 'Basics',
    title: 'Most expensive first',
    prompt: 'Show the name and unit_price of the 5 most expensive products, most expensive first.',
    hint: 'ORDER BY ... DESC sorts from high to low. LIMIT keeps the first rows.',
    solution: 'SELECT name, unit_price FROM products ORDER BY unit_price DESC LIMIT 5;',
  },
  {
    id: 'where-lagos',
    level: 'Filtering',
    title: 'Customers in Lagos State',
    prompt: 'Show the first_name, last_name and city of every customer whose state is Lagos.',
    hint: "Text values go in single quotes: WHERE state = 'Lagos'.",
    solution: "SELECT first_name, last_name, city FROM customers WHERE state = 'Lagos';",
  },
  {
    id: 'where-and',
    level: 'Filtering',
    title: 'Affordable phones',
    prompt: 'Show the name and unit_price of products in the Phones category that cost less than 200,000 naira.',
    hint: 'Combine two conditions with AND. Numbers have no quotes or commas.',
    solution: "SELECT name, unit_price FROM products WHERE category = 'Phones' AND unit_price < 200000;",
  },
  {
    id: 'where-in',
    level: 'Filtering',
    title: 'Several states at once',
    prompt: 'Show the first_name, last_name and state of customers in Kano, Kaduna or Enugu.',
    hint: "IN ('a', 'b', 'c') is shorter than three ORs.",
    solution: "SELECT first_name, last_name, state FROM customers WHERE state IN ('Kano', 'Kaduna', 'Enugu');",
  },
  {
    id: 'like',
    level: 'Filtering',
    title: 'Names that start with…',
    prompt: 'Show the first_name and last_name of customers whose last name starts with "Ok".',
    hint: "LIKE 'Ok%' matches any text that starts with Ok. % means \"anything\".",
    solution: "SELECT first_name, last_name FROM customers WHERE last_name LIKE 'Ok%';",
  },
  {
    id: 'is-null',
    level: 'Filtering',
    title: 'Missing emails',
    prompt: 'Show the customer_id, first_name and last_name of customers who have no email address.',
    hint: 'Missing values are NULL. Use IS NULL, because = NULL never matches.',
    solution: 'SELECT customer_id, first_name, last_name FROM customers WHERE email IS NULL;',
  },
  {
    id: 'count',
    level: 'Aggregates',
    title: 'How many delivered?',
    prompt: 'How many orders have the status delivered? Return a single number.',
    hint: 'COUNT(*) counts rows. Filter first with WHERE.',
    solution: "SELECT COUNT(*) AS delivered_orders FROM orders WHERE status = 'delivered';",
  },
  {
    id: 'group-by',
    level: 'Aggregates',
    title: 'Customers per state',
    prompt: 'Show each state and how many customers live there, with the biggest number first. Break ties alphabetically by state.',
    hint: 'GROUP BY state, then COUNT(*). ORDER BY can sort by more than one column.',
    solution: 'SELECT state, COUNT(*) AS customers FROM customers GROUP BY state ORDER BY customers DESC, state;',
  },
  {
    id: 'having',
    level: 'Aggregates',
    title: 'Big categories',
    prompt: 'Show the categories that have more than 5 products, with their product count.',
    hint: 'WHERE filters rows before grouping. HAVING filters groups after grouping.',
    solution: 'SELECT category, COUNT(*) AS products FROM products GROUP BY category HAVING COUNT(*) > 5;',
  },
  {
    id: 'avg-price',
    level: 'Aggregates',
    title: 'Average price per category',
    prompt: 'Show each category and its average unit_price, rounded to 2 decimal places, from most to least expensive.',
    hint: 'ROUND(AVG(unit_price), 2).',
    solution: 'SELECT category, ROUND(AVG(unit_price), 2) AS avg_price FROM products GROUP BY category ORDER BY avg_price DESC;',
  },
  {
    id: 'inner-join',
    level: 'Joins',
    title: 'Who placed each order?',
    prompt: 'For the first 10 orders (by order_id), show the order_id, order_date and the customer\'s first_name and last_name.',
    hint: 'JOIN customers ON orders.customer_id = customers.customer_id.',
    solution: `SELECT o.order_id, o.order_date, c.first_name, c.last_name
FROM orders o
JOIN customers c ON c.customer_id = o.customer_id
ORDER BY o.order_id
LIMIT 10;`,
  },
  {
    id: 'revenue-by-category',
    level: 'Joins',
    title: 'Revenue per category',
    prompt: 'Using order_items and products, show each category and its total revenue (quantity × the unit_price on the order line), highest first.',
    hint: 'SUM(oi.quantity * oi.unit_price), grouped by p.category.',
    solution: `SELECT p.category, SUM(oi.quantity * oi.unit_price) AS revenue
FROM order_items oi
JOIN products p ON p.product_id = oi.product_id
GROUP BY p.category
ORDER BY revenue DESC;`,
  },
  {
    id: 'left-join',
    level: 'Joins',
    title: 'Customers who never ordered',
    prompt: 'Show the customer_id, first_name and last_name of customers who have never placed an order.',
    hint: 'LEFT JOIN keeps every customer; customers with no orders get NULL order columns.',
    solution: `SELECT c.customer_id, c.first_name, c.last_name
FROM customers c
LEFT JOIN orders o ON o.customer_id = c.customer_id
WHERE o.order_id IS NULL;`,
  },
  {
    id: 'never-sold',
    level: 'Joins',
    title: 'Products nobody bought',
    prompt: 'Show the name and category of products that do not appear in any order.',
    hint: 'Either a LEFT JOIN with IS NULL, or NOT IN (SELECT product_id FROM order_items).',
    solution: `SELECT name, category
FROM products
WHERE product_id NOT IN (SELECT product_id FROM order_items);`,
  },
  {
    id: 'subquery',
    level: 'Advanced',
    title: 'Above average',
    prompt: 'Show the name and unit_price of products that cost more than the average product price, most expensive first.',
    hint: 'Compare with a subquery: WHERE unit_price > (SELECT AVG(unit_price) FROM products).',
    solution: `SELECT name, unit_price
FROM products
WHERE unit_price > (SELECT AVG(unit_price) FROM products)
ORDER BY unit_price DESC;`,
  },
  {
    id: 'case',
    level: 'Advanced',
    title: 'Price bands',
    prompt: "Show each product's name, unit_price and a price_band: 'budget' under 20,000, 'mid-range' under 100,000, otherwise 'premium'. Order by unit_price.",
    hint: 'CASE WHEN ... THEN ... WHEN ... THEN ... ELSE ... END.',
    solution: `SELECT name, unit_price,
       CASE
         WHEN unit_price < 20000 THEN 'budget'
         WHEN unit_price < 100000 THEN 'mid-range'
         ELSE 'premium'
       END AS price_band
FROM products
ORDER BY unit_price, name;`,
  },
  {
    id: 'cte',
    level: 'Advanced',
    title: 'Top spenders',
    prompt: 'Using payments, find the 5 customers who have paid the most in total. Show first_name, last_name and total_paid, highest first.',
    hint: 'A CTE (WITH ... AS) can total payments per customer first; then join to customers.',
    solution: `WITH spend AS (
  SELECT o.customer_id, SUM(p.amount) AS total_paid
  FROM payments p
  JOIN orders o ON o.order_id = p.order_id
  GROUP BY o.customer_id
)
SELECT c.first_name, c.last_name, s.total_paid
FROM spend s
JOIN customers c ON c.customer_id = s.customer_id
ORDER BY s.total_paid DESC
LIMIT 5;`,
  },
  {
    id: 'window',
    level: 'Advanced',
    title: 'Rank within category',
    prompt: 'Show each product\'s category, name, unit_price and its price_rank within its category (1 = most expensive). Order by category, then price_rank.',
    hint: 'RANK() OVER (PARTITION BY category ORDER BY unit_price DESC).',
    solution: `SELECT category, name, unit_price,
       RANK() OVER (PARTITION BY category ORDER BY unit_price DESC) AS price_rank
FROM products
ORDER BY category, price_rank, name;`,
  },
  {
    id: 'insert',
    level: 'Changing data',
    title: 'Add a product',
    prompt: "Add a new product: id 100, name 'Power Bank 20000mAh', category 'Phones', price 25000, stock 40. Then SELECT it to check.",
    hint: 'INSERT INTO products (columns...) VALUES (values...);',
    solution: `INSERT INTO products (product_id, name, category, unit_price, stock)
VALUES (100, 'Power Bank 20000mAh', 'Phones', 25000, 40);

SELECT * FROM products WHERE product_id = 100;`,
    checkable: false,
  },
  {
    id: 'update',
    level: 'Changing data',
    title: 'Price increase',
    prompt: 'Increase the price of every Groceries product by 10%. Then look at the new prices.',
    hint: 'UPDATE products SET unit_price = unit_price * 1.1 WHERE ...; Always write the WHERE first!',
    solution: `UPDATE products SET unit_price = unit_price * 1.1 WHERE category = 'Groceries';

SELECT name, unit_price FROM products WHERE category = 'Groceries';`,
    checkable: false,
  },
];
