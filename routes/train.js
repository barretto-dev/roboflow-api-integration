const express = require("express");

const { 
    startTrainDataset, 
    stopTrainDataset,
    trainingEvents
} = require("../controllers/train.js");

const router = express.Router();

router.post("/:datasetName/start", startTrainDataset);
router.delete("/stop", stopTrainDataset);
router.get("/events", trainingEvents);

module.exports = router;