const express = require("express");

const {
    getRoboflowProjects,
    getRoboflowDatasets,
    downloadTrainingWeights,
    downloadDatasetVersion
} = require("../controllers/roboflow.controller")

const router = express.Router()

router.get("/projects", getRoboflowProjects)
router.get("/:projectName/datasets", getRoboflowDatasets)

router.post("/trainings/download", downloadTrainingWeights)
router.post("/projects/:project/versions/:version/download", downloadDatasetVersion)


module.exports = router