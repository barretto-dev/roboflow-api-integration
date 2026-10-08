const express = require("express")

const { 
    getDatasets, 
    uploadDataset, 
    addDatasetFiles
} = require("../controllers/dataset.js")

const router = express.Router()

router.get("/", getDatasets)
router.post("/upload", uploadDataset)
router.put("/images", addDatasetFiles);

module.exports = router;