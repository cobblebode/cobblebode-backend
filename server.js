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
  res.json({ status: "ok", api: "CobbleBode backend rodando 🚀" });
});

/* ===============================
   PORTA (RENDER)
=============================== */
const PORT = process.env.PORT || 10000;

/* ===============================
   BANCO SQLITE
=============================== */
const db = new sqlite3.Database("./db.sqlite", (err) => {
  if (err) {
    console.error("Erro ao abrir SQLite:", err.message);
  } else {
    console.log("Banco SQLite conectado com sucesso");
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
  try {
    const rcon = await Rcon.connect({
      host: process.env.RCON_HOST,
      port: Number(process.env.RCON_PORT),
      password: process.env.RCON_PASSWORD,
    });

    const response = await rcon.send(command);
    await rcon.end();

    console.log("RCON executado:", command);
    return response;
  } catch (error) {
    console.error("Erro RCON:", error);
  }
}

/* ===============================
   SHOP
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
   CRIAR PAGAMENTO PIX
=============================== */
app.post("/api/payments/create", async (req, res) => {
  try {
    const { productId, productType, playerName, playerEmail } = req.body;

    if (!productId || !productType || !playerName || !playerEmail) {
      return res.status(400).json({ error: "Dados incompletos" });
    }

    const table =
      productType === "vip" ? "vip_products" : "shop_items";

    db.get(
      `SELECT * FROM ${table} WHERE id = ?`,
      [productId],
      async (err, product) => {
        if (err || !product) {
          return res.status(404).json({ error: "Produto não encontrado" });
        }

        db.run(
          `
          INSERT INTO orders (player, product_type, product_id, status)
          VALUES (?, ?, ?, ?)
          `,
          [playerName, productType, productId, "pending"],
          async function (err) {
            if (err) {
              console.error(err);
              return res.status(500).json({ error: "Erro ao criar pedido" });
            }

            const orderId = this.lastID;

            const payment = new Payment(mpClient);
            const mpResponse = await payment.create({
              body: {
                transaction_amount: product.price,
                description: product.name,
                payment_method_id: "pix",
                payer: {
                  email: playerEmail,
                },
                metadata: {
                  order_id: orderId,
                  player: playerName,
                  product_type: productType,
                  product_id: productId,
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
              amount: product.price,
            });
          }
        );
      }
    );
  } catch (error) {
    console.error("Erro ao criar pagamento:", error);
    res.status(500).json({ error: "Erro ao criar pagamento PIX" });
  }
});

/* ===============================
   WEBHOOK MERCADO PAGO (FINAL)
=============================== */
app.post("/api/webhook/mercadopago", async (req, res) => {
  try {
    console.log("Webhook recebido:", JSON.stringify(req.body, null, 2));

    const paymentId = req.body?.data?.id;
    if (!paymentId) {
      console.log("Webhook sem paymentId");
      return res.sendStatus(200);
    }

    const payment = new Payment(mpClient);
    const mpPayment = await payment.get({ id: paymentId });

    console.log("Pagamento:", {
      id: mpPayment.id,
      status: mpPayment.status,
      metadata: mpPayment.metadata,
    });

    if (mpPayment.status !== "approved") {
      return res.sendStatus(200);
    }

    const { order_id, player, product_type, product_id } =
      mpPayment.metadata;

    if (!order_id || !player) {
      console.error("Metadata incompleta");
      return res.sendStatus(200);
    }

    db.run(
      "UPDATE orders SET status = 'approved' WHERE id = ?",
      [order_id]
    );

    // ITEM DE TESTE (R$1)
    if (product_type === "shop") {
      await sendRconCommand(
        `give ${player} minecraft:diamond 1`
      );
      console.log(`Diamante entregue para ${player}`);
    }

    // VIP
    if (product_type === "vip") {
      db.get(
        "SELECT duration_days FROM vip_products WHERE id = ?",
        [product_id],
        async (err, vip) => {
          if (err || !vip) return;

          await sendRconCommand(
            `lp user ${player} parent addtemp vip ${vip.duration_days}d`
          );

          console.log(`VIP aplicado para ${player}`);
        }
      );
    }

    res.sendStatus(200);
  } catch (error) {
    console.error("Erro no webhook:", error);
    res.sendStatus(500);
  }
});

/* ===============================
   START
=============================== */
app.listen(PORT, () => {
  console.log(`Backend CobbleBode rodando na porta ${PORT}`);
});
