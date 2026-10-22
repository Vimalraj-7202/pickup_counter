-- Prices are whole paise. 4500 paise is 45 rupees. One Mango Soda matches the sample webhook amount.
INSERT INTO products (id, name, price_paise, stock)
VALUES
  (1, 'Potato Chips', 2000, 10),
  (2, 'Salted Peanuts', 1500, 10),
  (3, 'Mango Soda', 4500, 8),
  (4, 'Dark Chocolate', 3000, 6),
  (5, 'Water Bottle', 1000, 20)
ON CONFLICT (id) DO NOTHING;

SELECT setval(
  'products_id_seq',
  GREATEST((SELECT MAX(id) FROM products), 1)
);
