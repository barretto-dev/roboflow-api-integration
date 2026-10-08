const {
    getProjects,
    getDatasetsAndTrainings,
    downloadWeights,
    downloadVersion
} = require("../services/roboflow.service")

async function getRoboflowProjects(req, res) {
    try {

        const projects = await getProjects();
        return res.status(200).json({projects})

    } catch (error) {
        console.error("Erro ao buscar projetos do Roboflow:", error)

        if (error.code === "ROBOFLOW_ERROR") {
            return res.status(502).json({
                message: "Erro ao acessar o Roboflow",
                details: error.message
            })
        }
        return res.status(500).json({message: "Erro ao buscar projetos do Roboflow"})
    }
}

async function getRoboflowDatasets(req, res) {

    try {
        const { projectName } = req.params;
        const datasets = await getDatasetsAndTrainings(projectName);
        return res.status(200).json({project: projectName, datasets})

    } catch (error) {
        console.error("Erro Roboflow:", error)

        if (error.code === "ROBOFLOW_ERROR") {
            return res.status(502).json({message:"Erro ao acessar Roboflow", details: error.message })
        }

        return res.status(500).json({message:"Erro ao buscar datasets do Roboflow"})
    }
}

async function downloadTrainingWeights(req, res) {
    try {
        const { project, training_id, model_id } = req.body;

        if (!training_id) 
            return res.status(400).json({message: "training_id é obrigatório"})

        const result = await downloadWeights(project, training_id, model_id)

        return res.status(200).json({
            message: "Modelo baixado com sucesso",
            training_id,
            model_id,
            path: result.path
        });

    } catch (error) {
        console.error(error);

        if (error.code === "WEIGHTS_NOT_AVAILABLE")
            return res.status(400).json({message: "Os pesos deste modelo não estão disponíveis para download"})

        return res.status(500).json({message:"Erro ao baixar os pesos do treinamento"})
    }
}

async function downloadDatasetVersion(req, res) {
    try {

        const {project, version} = req.params
        const {format = "yolo26", overwrite = false} = req.body ?? {}
        const dataset = await downloadVersion({
            project,
            version,
            format,
            overwrite
        })

        return res.status(200).json({
            message: dataset.already_downloaded
                ? "Dataset já existe localmente"
                : "Dataset baixado com sucesso",

            project: dataset.project,
            version: dataset.version,
            format: dataset.format,
            path: dataset.path,
            already_downloaded:
                dataset.already_downloaded
        })

    } catch (error) {
        console.error(error);

        if (error.code === "ROBOFLOW_ERROR")
            return res.status(502).json({message:"Erro ao acessar o Roboflow", details: error.message})

        if (error.code === "EXPORT_TIMEOUT")
            return res.status(504).json({message:"O Roboflow não finalizou a exportação do dataset"})

        if (error.code === "DOWNLOAD_ERROR")
            return res.status(502).json({message: "Erro ao baixar o arquivo do Roboflow"})

        return res.status(500).json({message:"Erro ao baixar o dataset"})
    }
}


module.exports = {
    getRoboflowProjects,
    getRoboflowDatasets,
    downloadTrainingWeights,
    downloadDatasetVersion
};