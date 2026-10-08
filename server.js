require("dotenv").config();
const express = require("express");
const cors = require("cors");

const datasetRoutes = require("./routes/dataset.js")
const trainRoutes = require("./routes/train.js")
const roboflowRoutes = require("./routes/roboflow.route")

const app = express();
const PORT = 3000;

app.use(cors());
app.use(express.json());

app.get("/", (req, res) => {
    res.json({message: "API funcionando!"});
});

app.use("/datasets", datasetRoutes);
app.use("/trains", trainRoutes);
app.use("/roboflow", roboflowRoutes);

app.listen(PORT, () => {
    console.log(`Servidor rodando em http://localhost:${PORT}`);
});