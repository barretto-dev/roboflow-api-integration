const {getTrainingState, removePreviousTraining} = require("./train.js");

const fs = require("fs/promises")
const path = require("path")
const crypto = require("crypto");
const unzipper = require("unzipper");

const datasetPath = process.env.ROBOFLOW_DATASETS_DIR
const tempPath = path.resolve(process.cwd(), "../dataset_upload_temp");
const imageExtensions = [".jpg", ".jpeg", ".png", ".bmp", ".webp"]

async function listDatasets() {
    const items = await fs.readdir(datasetPath, {withFileTypes: true});

    const datasetFolders = items.filter(item => item.isDirectory());

    const datasets = await Promise.all(
        datasetFolders.map(async dataset => {
            const basePath = path.join(
                datasetPath,
                dataset.name
            )

            const [train, valid, test] = await Promise.all([
                countImages(path.join(basePath, "train", "images")),
                countImages(path.join(basePath, "valid", "images")),
                countImages(path.join(basePath, "test", "images"))
            ])

            training_status = null

            const state = getTrainingState()

            //verifica o dataset está em treinamento
            if (state.running && state.datasetName == dataset.name)
                training_status = "TRAINING"
            else{
                already_trained = await datasetHasLocalTraining(dataset.name)
                training_status = already_trained ? "TRAINED" : "NOT TRAINED"
            }

            return {
                name: dataset.name,
                training_status,
                train,
                valid,
                test,
                total: train + valid + test
            }
        })
    )

    return datasets;
}

async function saveDataset(name, zipPath) {

    validateDatasetName(name)
    const destination = path.join(datasetPath, name)

    //Verifica se já existe um dataset com esse nome.
    if (await exists(destination)) {

        await fs.rm(zipPath, {force: true});
        const error = new Error("Dataset já existe");
        error.code = "DATASET_EXISTS";
        throw error;
    }

    await fs.mkdir(tempPath, {recursive: true});
    await fs.mkdir(datasetPath, {recursive: true});

    const extractionPath = path.join(tempPath, crypto.randomUUID())

    await fs.mkdir(extractionPath, {recursive: true})

    try {
        let zip

        try {
            zip = await unzipper.Open.file(zipPath)
        } catch {
            const error = new Error("ZIP inválido")
            error.code = "INVALID_ZIP";
            throw error;
        }

        //Verifica caminhos perigosos.
        validateZipEntries(zip.files);

        //Extrai para uma pasta temporária.
        await zip.extract({path: extractionPath});

        
        //Descobre onde está a raiz real do dataset.
        const datasetRoot = await findDatasetRoot(extractionPath );

        if (!datasetRoot) {
            const error = new Error("Não foi possível encontrar a raiz do dataset")
            error.code = "INVALID_DATASET_STRUCTURE"
            error.missing = ["data.yaml"]
            throw error;
        }

        
        //Valida train, valid, test etc.
        await validateDatasetStructure(datasetRoot);

        //Contabilizar imagens de treino, validação e teste
        const [train, valid, test] = await Promise.all([
            countImages(path.join(datasetRoot,"train","images")),
            countImages(path.join(datasetRoot,"valid","images")),
            countImages(path.join(datasetRoot, "test", "images"))
        ])

        //Move o dataset validado para ../dataset/nome
        await fs.rename(datasetRoot, destination)
        return {
            name,
            training_status: "NOT TRAINED",
            train,
            valid, 
            test, 
            total: train + valid + test
        }

    } finally {
        //Remove o ZIP enviado.
        await fs.rm(zipPath, {force: true});

        //Remove arquivos temporários.
        await fs.rm(extractionPath, {recursive: true, force: true})
    }
}

async function addFilesToDataset(datasetName, zipPath) {

    const extractionPath = path.join(tempPath, crypto.randomUUID());

    try {

        // 1. Valida nome
        validateDatasetName(datasetName)
        const destination = path.join(datasetPath, datasetName)

        // 2. Dataset precisa existir
        if (!(await exists(destination))) {
            const error = new Error("Dataset não encontrado")
            error.code = "DATASET_NOT_FOUND"
            throw error
        }

        await fs.mkdir(extractionPath, {recursive: true})

        // 3. Abre ZIP
        let zip;

        try {
            zip = await unzipper.Open.file(zipPath)
        } catch {
            const error = new Error("ZIP inválido")
            error.code = "INVALID_ZIP"
            throw error
        }

        // 4. Segurança dos caminhos
        validateZipEntries(zip.files)

        // 5. Extrai temporariamente
        await zip.extract({path: extractionPath})

        // 6. Localiza estrutura
        const updateRoot = await findUpdateRoot(extractionPath)

        if (!updateRoot) {
            const error = new Error("Estrutura do ZIP inválida")
            error.code ="INVALID_UPDATE_STRUCTURE"
             error.missing = [
                "train/images e train/labels",
                "valid/images e valid/labels",
                "test/images e test/labels"
            ]
            throw error
        }

        // 7. Valida estrutura
        await validateUpdateStructure(updateRoot)

        // 8. Copia arquivos
        await copyDatasetFiles(updateRoot,destination)

        // 9 . Contabilizar imagens de treino, validação e teste
        const [train, valid, test] = await Promise.all([
            countImages(path.join(destination,"train","images")),
            countImages(path.join(destination,"valid","images")),
            countImages(path.join(destination, "test", "images"))
        ])

        // 10. Remover treinamento anterior
        await removePreviousTraining(datasetName)

        return {
            name: datasetName,
            training_status: "NOT TRAINED",
            train,
            valid,
            test,
            total: train + valid + test
        };

    } finally {

        // Remove ZIP recebido pelo Multer
        await fs.rm(zipPath, {force: true})

        // Remove extração temporária
        await fs.rm(extractionPath, {recursive: true, force: true})
    }
}


// !!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!

//AUXILIARY FUNCTIONS

// !!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!

async function countImages(folderPath) {
    try {
        const files = await fs.readdir(folderPath, {withFileTypes: true});

        const images = files.filter(file => {
            if (!file.isFile()) 
                return false;

            const extension = path
                .extname(file.name)
                .toLowerCase();

            return imageExtensions.includes(extension);
        });

        return images.length;

    } catch (error) {
        if (error.code === "ENOENT") 
            return 0;

        throw error;
    }
}

async function datasetHasLocalTraining(projectName) {

    const trainingPath = path.resolve(process.cwd(), "runs", "detect", projectName)

    try {
        const stats = await fs.stat(trainingPath);
        return stats.isDirectory();

    } catch (error) {
        if (error.code === "ENOENT")
            return false;

        throw error;
    }
}

async function exists(filePath) {
    try {
        await fs.access(filePath)
        return true;
    } catch { return false }
}

function validateDatasetName(name) {
    const pattern = /^[a-zA-Z0-9_-]+$/

    if (!pattern.test(name)) {
        const error = new Error("Nome de dataset inválido")
        error.code = "INVALID_DATASET_NAME"
        throw error
    }
}

function validateZipEntries(files) {
    for (const file of files) {
        const zipPath = file.path.replace(/\\/g, "/");

        if (
            zipPath.startsWith("/") ||
            /^[a-zA-Z]:\//.test(zipPath) ||
            zipPath.split("/").includes("..")
        ) {
            const error = new Error("ZIP contém caminhos inválidos")
            error.code = "INVALID_ZIP"
            throw error
        }
    }
}

async function findDatasetRoot(extractedPath) {

    const directYaml = path.join(extractedPath,"data.yaml")

    if (await exists(directYaml)) 
        return extractedPath

    const items = await fs.readdir(extractedPath, {withFileTypes: true})

    const directories = items.filter(
        item => item.isDirectory() && item.name !== "__MACOSX"
    );

    if (directories.length !== 1)
        return null

    const candidate = path.join(extractedPath, directories[0].name)
    const yaml = path.join(candidate, "data.yaml")

    if (await exists(yaml)) 
        return candidate;

    return null;
}

async function validateDatasetStructure(root) {

    const required = [
        {path: "data.yaml", type: "file"},
        {path: "train/images", type: "directory"},
        {path: "train/labels", type: "directory"},
        {path: "valid/images", type: "directory"},
        {path: "valid/labels", type: "directory"},
        {path: "test/images", type: "directory"},
        {path: "test/labels", type: "directory"}
    ]

    const missing = [];

    for (const item of required) {

        const itemPath = path.join(root, item.path)

        try {
            const stats = await fs.stat(itemPath)

            if (item.type === "file" && !stats.isFile()) 
                missing.push(item.path)

            if (item.type === "directory" && !stats.isDirectory())
                missing.push(item.path)
            
        } catch {missing.push(item.path)}
    }

    if (missing.length > 0) {
        const error = new Error("Estrutura inválida")
        error.code = "INVALID_DATASET_STRUCTURE"
        error.missing = missing;
        throw error;
    }
}

async function findUpdateRoot(extractionPath) {
    const splits = ["train", "valid", "test"]

    // Verifica se train/valid/test estão diretamente na raiz do ZIP.
    for (const split of splits) {
        let folder_exists = await exists(path.join(extractionPath, split))
        if (folder_exists){
            return extractionPath;
        }
    }

    // Caso o ZIP tenha uma pasta externa:
    //
    // arquivo.zip
    // └── minha_pasta/
    //     ├── train/
    //     ├── valid/
    //     └── test/

    const items = await fs.readdir(extractionPath,{withFileTypes: true})
    const directories = items.filter(
        item =>
            item.isDirectory() &&
            item.name !== "__MACOSX"
    );

    if (directories.length !== 1) 
        return null

    const candidate = path.join(extractionPath, directories[0].name);

    for (const split of splits) {
        var candidate_exists = await exists(path.join(candidate, split))
        if (candidate_exists) 
            return candidate;
    }

    return null;
}

async function validateUpdateStructure(root) {

    const splits = ["train","valid","test"]
    let foundSplit = false;
    const missing = [];

    for (const split of splits) {
        const splitPath = path.join(root, split)

        if (!(await exists(splitPath))) 
            continue;

        foundSplit = true;

        const imagesPath = path.join(splitPath, "images")
        const labelsPath = path.join(splitPath, "labels")

        if (!(await exists(imagesPath)))
            missing.push(`${split}/images`)

        if (!(await exists(labelsPath)))
            missing.push(`${split}/labels`)
    }

    if (!foundSplit) {
        const error = new Error("Nenhum split encontrado")
        error.code = "INVALID_UPDATE_STRUCTURE"
        error.missing = ["train, valid ou test"]
        throw error;
    }

    if (missing.length > 0) {
        const error = new Error("Estrutura inválida");
        error.code = "INVALID_UPDATE_STRUCTURE";
        error.missing = missing;
        throw error;
    }
}

async function copyFilesWithOverwrite(source, destination, type) {

    if (!(await exists(source))) 
        return

    await fs.mkdir(destination, {recursive: true})

    const files = await fs.readdir(source, {withFileTypes: true})

    for (const file of files) {

        if (!file.isFile()) 
            continue;

        const extension = path.extname(file.name).toLowerCase();

        if (type === "images" && !imageExtensions.includes(extension))
            continue

        if (type === "labels" && extension !== ".txt") 
            continue

        const sourceFile = path.join(source, file.name)
        const destinationFile = path.join(destination, file.name)

        await fs.copyFile(sourceFile, destinationFile)
    }
}

async function copyDatasetFiles(sourceRoot, destinationRoot) {
    const splits = ["train", "valid", "test"]

    for (const split of splits) {
        const sourceSplit = path.join(sourceRoot, split)

        if (!(await exists(sourceSplit))) 
            continue

        await copyFilesWithOverwrite(
            path.join(sourceSplit, "images"),
            path.join( destinationRoot, split, "images"),
            "images"
        )

        await copyFilesWithOverwrite(
            path.join(sourceSplit, "labels"),
            path.join(destinationRoot, split, "labels"),
            "labels"
        )
    }
}

module.exports = {
    listDatasets,
    saveDataset,
    addFilesToDataset,
    datasetHasLocalTraining
};