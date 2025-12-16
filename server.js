require("dotenv").config();

const express = require("express");
const cors = require("cors");
const sqlite3 = require("sqlite3").verbose();
const { MercadoPagoConfig, Payment } = require("mercadopago");

const app = express();

/* ===============================
   CONFIG BÁSICA
=============================== */
app.use(cors());
app.use(express.json());

app.get("/", (req, res) => {
  res.send("Backend CobbleBode online 🚀");
});

app.get("/health", (req, res) => {
  res.json({ status: "ok" });
});

/* ===============================
   PORTA
=============================== */
const PORT = process.env.PORT || 10000;

/* ===============================
   SQLITE
=============================== */
const db = new sqlite3.Database("./db.sqlite", (err) => {
  if (err) {
    console.error("❌ Erro SQLite:", err.message);
  } else {
    console.log("✅ SQLite conectado");
  }
});

/* ===============================
   MERCADO PAGO
=============================== */
const mpClient = new MercadoPagoConfig({
  accessToken: process.env.MP_ACCESS_TOKEN,
});

/* ===============================
   SHOP (PÚBLICO)
=============================== */
app.get("/api/shop", (req, res) => {
  db.all(
    "SELECT * FROM shop_items WHERE is_active = 1",
    [],
    (err, rows) => {
      if (err) return res.status(500).json({ error: err.message });
      res.json(rows);
    }
  );
});

/* ===============================
   VIP (PÚBLICO)
=============================== */
app.get("/api/vip", (req, res) => {
  db.all(
    "SELECT * FROM vip_products WHERE is_active = 1",
    [],
    (err, rows) => {
      if (err) return res.status(500).json({ error: err.message });
      res.json(rows);
    }
  );
});

/* ===============================
   CRIAR PAGAMENTO PIX
=============================== */
app.post("/api/payments/create", (req, res) => {
  const { productId, productType, quantity = 1, playerName, playerEmail } =
    req.body;

  if (!productId || !productType || !playerName || !playerEmail) {
    return res.status(400).json({ error: "Dados incompletos" });
  }

  const table = productType === "vip" ? "vip_products" : "shop_items";

  db.get(`SELECT * FROM ${table} WHERE id = ?`, [productId], async (err, product) => {
    if (err || !product)
      return res.status(404).json({ error: "Produto não encontrado" });

    db.run(
      `
      INSERT INTO orders (player, product_type, product_id, quantity, status, delivered)
      VALUES (?, ?, ?, ?, 'pending', 0)
      `,
      [playerName, productType, productId, quantity],
      async function (err) {
        if (err)
          return res.status(500).json({ error: "Erro ao criar pedido" });

        const orderId = this.lastID;
        const payment = new Payment(mpClient);

        const mpResponse = await payment.create({
          body: {
            transaction_amount: Number(product.price) * quantity,
            description: `${product.name} x${quantity}`,
            payment_method_id: "pix",
            payer: { email: playerEmail },
            metadata: {
              order_id: orderId,
              player: playerName,
              product_type: productType,
              product_id: productId,
              quantity,
            },
          },
        });

        res.json({
          orderId,
          paymentId: mpResponse.id,
          status: mpResponse.status,
          qrCode:
            mpResponse.point_of_interaction.transaction_data.qr_code_base64,
          qrCodeText:
            mpResponse.point_of_interaction.transaction_data.qr_code,
          amount: Number(product.price) * quantity,
        });
      }
    );
  });
});

/* ===============================
   WEBHOOK MERCADO PAGO
   ⚠️ NÃO ENTREGA NADA
=============================== */
app.post("/api/webhook/mercadopago", async (req, res) => {
  try {
    const paymentId = req.body?.data?.id;
    if (!paymentId) return res.sendStatus(200);

    const payment = new Payment(mpClient);
    const mpPayment = await payment.get({ id: paymentId });

    if (mpPayment.status !== "approved") return res.sendStatus(200);

    const { order_id } = mpPayment.metadata || {};
    if (!order_id) return res.sendStatus(200);

    db.run(
      "UPDATE orders SET status='approved' WHERE id = ?",
      [order_id]
    );

    return res.sendStatus(200);
  } catch (e) {
    console.error("Webhook erro:", e.message);
    return res.sendStatus(200);
  }
});

/* ===============================
   START
=============================== */
app.listen(PORT, () => {
  console.log(`🚀 Backend CobbleBode rodando na porta ${PORT}`);
});
