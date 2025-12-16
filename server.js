require("dotenv").config();

const express = require("express");
const cors = require("cors");
const sqlite3 = require("sqlite3").verbose();

const { MercadoPagoConfig, Payment } = require("mercadopago");
const { Rcon } = require("rcon-client");

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
    console.error("❌ Erro ao abrir SQLite:", err.message);
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
   RCON
=============================== */
async function sendRconCommand(command) {
  const rcon = await Rcon.connect({
    host: process.env.RCON_HOST,
    port: Number(process.env.RCON_PORT),
    password: process.env.RCON_PASSWORD,
  });

  const response = await rcon.send(command);
  await rcon.end();

  console.log("🎮 RCON:", command);
  return response;
}

/* ===============================
   GIVE ITEM COM NOME CUSTOMIZADO
=============================== */
function buildGiveItemCommand(player, itemId, quantity, displayName) {
  const customName = JSON.stringify({
    text: displayName,
    color: "gold",
    bold: true,
  });

  return `give ${player} ${itemId}[minecraft:custom_name='${customName}'] ${quantity}`;
}

/* ===============================
   SHOP (PÚBLICO)
=============================== */
app.get("/api/shop", (req, res) => {
  db.all("SELECT * FROM shop_items WHERE is_active = 1", [], (err, rows) => {
    if (err) return res.status(500).json({ error: err.message });
    res.json(rows);
  });
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
=============================== */
app.post("/api/webhook/mercadopago", async (req, res) => {
  try {
    const paymentId = req.body?.data?.id;
    if (!paymentId) return res.sendStatus(200);

    const payment = new Payment(mpClient);
    const mpPayment = await payment.get({ id: paymentId });

    if (mpPayment.status !== "approved") return res.sendStatus(200);

    const { order_id, player, product_type, product_id, quantity } =
      mpPayment.metadata || {};

    if (!order_id || !player) return res.sendStatus(200);

    db.get(
      "SELECT delivered FROM orders WHERE id = ?",
      [order_id],
      async (err, row) => {
        if (row?.delivered === 1) return res.sendStatus(200);

        db.run(
          "UPDATE orders SET status='approved', delivered=1 WHERE id = ?",
          [order_id]
        );

        /* ===== SHOP ITEMS ===== */
        if (product_type === "shop") {
          let command = "";
          let displayName = "";

          if (product_id === 1) {
            displayName = "Chave Lendária Gen 1-3";
            command = buildGiveItemCommand(
              player,
              "cobblemontrainerbattle:elite_aaron_ticket",
              quantity,
              displayName
            );
          }

          if (product_id === 2) {
            displayName = "Chave Lendária Gen 4-5";
            command = buildGiveItemCommand(
              player,
              "cobblemontrainerbattle:leader_volkner_ticket",
              quantity,
              displayName
            );
          }

          if (product_id === 3) {
            displayName = "Chave Lendária Gen 6-7";
            command = buildGiveItemCommand(
              player,
              "cobblemontrainerbattle:gen_6_7_ticket",
              quantity,
              displayName
            );
          }

          if (product_id === 4) {
            displayName = "Chave Lendária Gen 8-9";
            command = buildGiveItemCommand(
              player,
              "cobblemontrainerbattle:gen_8_9_ticket",
              quantity,
              displayName
            );
          }

          if (command) {
            await sendRconCommand(command);

            await sendRconCommand(
              `say §6✨ §e${player} §acomprou §6${quantity}x ${displayName} §ana loja! §6✨`
            );
          }
        }

        /* ===== VIP ===== */
        if (product_type === "vip") {
          db.get(
            "SELECT duration_days, name FROM vip_products WHERE id = ?",
            [product_id],
            async (err, vip) => {
              if (!vip) return;

              await sendRconCommand(
                `lp user ${player} parent addtemp vip ${vip.duration_days}d accumulate`
              );

              await sendRconCommand(
                `say §6⭐ §e${player} §aativou §6VIP ${vip.name} §apela loja!`
              );
            }
          );
        }

        return res.sendStatus(200);
      }
    );
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
