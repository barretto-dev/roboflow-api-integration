const {
    listDatasets,
    saveDataset,
    addFilesToDataset
} = require("../services/dataset.js");

const {
    receiveDatasetZip
} = require("../middlewares/datasetUpload.js");

async function getDatasets(req, res) {
    try {
        const datasets = await listDatasets();
        return res.status(200).json({datasets});

    } catch (error) {
        console.error("Erro ao buscar datasets:", error);

        return res.status(500).json({
            message: "Erro ao buscar os datasets"
        });
    }
}

async function uploadDataset(req, res) {
    try {
        // Processa o multipart/form-data
        await receiveDatasetZip(req, res)

        const { name } = req.body

        if (!name) 
            return res.status(400).json({message: "O nome do dataset é obrigatório"})

        if (!req.file) 
            return res.status(400).json({message: "O arquivo ZIP é obrigatório"})

        const dataset = await saveDataset(name, req.file.path)

        return res.status(201).json({message: "Dataset adicionado com sucesso", dataset})

    } catch (error) {
        console.error(error)

        if (error.code === "INVALID_DATASET_NAME")
            return res.status(400).json({message: "Nome de dataset inválido"})

        if (error.code === "DATASET_EXISTS")
            return res.status(409).json({message: "Já existe um dataset com esse nome"})

        if (error.code === "INVALID_ZIP") 
            return res.status(400).json({message: "O arquivo enviado não é um ZIP válido"})

        if (error.code === "INVALID_DATASET_STRUCTURE") {
            return res.status(400).json({
                message: "Estrutura do dataset inválida",
                missing: error.missing
            })
        }

        return res.status(500).json({message: "Erro ao adicionar dataset"})
    }
}

async function addDatasetFiles(req, res) {
    try {

        await receiveDatasetZip(req, res)
        
        const { name } = req.body

        if (!req.file) 
            return res.status(400).json({message: "O arquivo ZIP é obrigatório"})

        const dataset = await addFilesToDataset(name, req.file.path)
        return res.status(200).json(dataset)

    } catch (error) {
        console.error(error);

        if (error.code === "INVALID_DATASET_NAME")
            return res.status(400).json({message: "Nome de dataset inválido"});

        if (error.code === "DATASET_NOT_FOUND")
            return res.status(404).json({message: "Dataset não encontrado"})

        if (error.code === "INVALID_ZIP")
            return res.status(400).json({message: "O arquivo enviado não é um ZIP válido"})

        if (error.code === "INVALID_UPDATE_STRUCTURE") {
            return res.status(400).json({
                message: "Estrutura do ZIP inválida",
                missing: error.missing ?? []
            });
        }

        return res.status(500).json({message: "Erro ao adicionar arquivos ao dataset"});
    }
}

module.exports = {
    getDatasets,
    uploadDataset,
    addDatasetFiles
};