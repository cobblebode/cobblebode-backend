const express = require("express");
const cors = require("cors");
const sqlite3 = require("sqlite3").verbose();
require("dotenv").config();

const { MercadoPagoConfig, Payment } = require("mercadopago");
const { Rcon } = require("rcon-client");

const app = express();
const PORT = 3001;

// ===============================
// MERCADO PAGO
// ===============================
const mpClient = new MercadoPagoConfig({
  accessToken: process.env.MP_ACCESS_TOKEN,
});

// ===============================
// MIDDLEWARES
// ===============================
app.use(cors());
app.use(express.json());

// ===============================
// BANCO DE DADOS
// ===============================
const db = new sqlite3.Database("./db.sqlite", (err) => {
  if (err) {
    console.error("Erro ao abrir o banco:", err.message);
  } else {
    console.log("Banco SQLite conectado com sucesso");
  }
});

// ===============================
// RCON
// ===============================
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

// ===============================
// ROTAS BÁSICAS
// ===============================
app.get("/health", (req, res) => {
  res.json({ status: "ok", api: "CobbleBode backend rodando 🚀" });
});

// Loja de itens
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

// Loja VIP
app.get("/api/vips", (req, res) => {
  db.all(
    "SELECT * FROM vip_products WHERE is_active = 1",
    [],
    (err, rows) => {
      if (err) return res.status(500).json({ error: err.message });
      res.json(rows);
    }
  );
});

// ===============================
// CRIAR PAGAMENTO PIX
// ===============================
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

        // Criar pedido
        db.run(
          `
          INSERT INTO orders (player, product_type, product_id, status)
          VALUES (?, ?, ?, ?)
        `,
          [playerName, productType, productId, "pending"],
          async function (err) {
            if (err) {
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
                  first_name: playerName,
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

// ===============================
// WEBHOOK MERCADO PAGO
// ===============================
app.post("/api/webhook/mercadopago", async (req, res) => {
  try {
    const { type, data } = req.body;

    if (type !== "payment") {
      return res.sendStatus(200);
    }

    const paymentId = data.id;
    const payment = new Payment(mpClient);

    const mpPayment = await payment.get({ id: paymentId });

    const status = mpPayment.status;
    const metadata = mpPayment.metadata;

    console.log("Pagamento recebido:", {
      paymentId,
      status,
      metadata,
    });

    if (status === "approved") {
      const orderId = metadata.order_id;
      const player = metadata.player;
      const productType = metadata.product_type;
      const productId = metadata.product_id;

      // ===============================
      // VIP TEMPORÁRIO
      // ===============================
      if (productType === "vip") {
        db.get(
          "SELECT duration_days FROM vip_products WHERE id = ?",
          [productId],
          async (err, vip) => {
            if (err || !vip) {
              console.error("Erro ao buscar duração do VIP");
              return;
            }

            const days = vip.duration_days;

            await sendRconCommand(
              `lp user ${player} parent addtemp vip ${days}d`
            );

            console.log(
              `VIP aplicado para ${player} por ${days} dias`
            );
          }
        );
      }

      db.run(
        `UPDATE orders SET status = 'approved' WHERE id = ?`,
        [orderId],
        (err) => {
          if (err) {
            console.error("Erro ao atualizar pedido:", err);
            return;
          }

          console.log(`Pedido ${orderId} aprovado com sucesso`);
        }
      );
    }

    res.sendStatus(200);
  } catch (error) {
    console.error("Erro no webhook:", error);
    res.sendStatus(500);
  }
});

// ===============================
app.listen(PORT, () => {
  console.log(`API rodando em http://localhost:${PORT}`);
});
