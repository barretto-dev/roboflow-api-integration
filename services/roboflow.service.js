const roboflowConfig = require("../config/roboflow.config")
const {getTrainingState} = require("./train.js");
const {datasetHasLocalTraining} = require("./dataset.js")

const fs = require("fs/promises")
const path = require("path")
const crypto = require("crypto")
const unzipper = require("unzipper")

const {createWriteStream} = require("fs")
const {Readable} = require("stream")
const {pipeline} = require("stream/promises")

const datasetPath = path.resolve(process.cwd(), "../datasets")

async function getProjects() {
    const { workspace } = roboflowConfig;

    const data = await roboflowRequest(`/${encodeURIComponent(workspace)}`)
    const state = getTrainingState()

    const projects = data.workspace?.projects ?? []

    let result =  await Promise.all(
        projects.map(async project => {

            // Verifica projeto tem um dataset padrao selecionado e verifica sua versao
            const selectedDatasetPath = path.join(datasetPath, project.name)
            let datasetVersion = null

            try {
                await fs.stat(selectedDatasetPath)
                const versionPath = path.join(selectedDatasetPath, "version.json");
                const fileContent = await fs.readFile(versionPath, "utf-8")
                const data = JSON.parse(fileContent)
                datasetVersion = data.version
            } catch {}

            //Verificar se o dataset default ja foi treinado
            const already_trained = await datasetHasLocalTraining(project.name)
            let training_status = null

            //verifica se este projeto possui algum dataset ja treinado ou em treinamento
            if (state.running && state.projectName == project.name)
                training_status = "TRAINING"
            else{
                training_status = already_trained ? "TRAINED" : "NOT TRAINED"
            }

            return {
                name: project.name,
                id: project.id,
                datasetVersion: datasetVersion,
                training_status,
            }
        })
    )

    return result
}

async function getDatasetsAndTrainings(projectName) {

    const versions = await getProjectVersions(projectName)

    // verificar a versão do dataset que foi selecionada pra ser usada no
    // projeto atualemnte. Pode retornar null caso nenhuma foi escolhida
    const current_version_used = await getLocalDatasetVersion(projectName)
    
    // verifica se o projeto possui um treinamento feito localmente.
    // cada projeto pode ter apenas um unico treinamento salvo
    const already_trained = await datasetHasLocalTraining(projectName)

    const result = await Promise.all(
        versions.map(async version => {

            const versionNumber = version.id.toString().split("/").pop();
            const trainings = await getVersionTrainings(versionNumber, projectName)

            //Separando o numero de imagens de treino validçao e teste
            let train, valid, test = null

            if(version.splits){
                train = version.splits.train
                valid = version.splits.valid
                test = version.splits.test
            }

            //verificar status
            let training_status = null
            const state = getTrainingState()

            //verifica o dataset está em treinamento local ou ja foi treinada
            if (state.running && state.projectName == projectName && state.datasetVersion == versionNumber)
                training_status = "TRAINING"
            else{
                is_this_version_trained = versionNumber == current_version_used
                training_status = already_trained && is_this_version_trained ? "TRAINED" : "NOT TRAINED"
            }

            return {
                version: Number(versionNumber),
                is_default: versionNumber == current_version_used,
                train,
                valid,
                test,
                total: version.images ?? 0,
                training_status,
                created:  version.created ? new Date(version.created * 1000).toISOString() : null,
                /* trainings: trainings.map(
                    training => ({
                        id: training.id,
                        status: training.status,
                        model_type: training.modelType,
                        job_type: training.jobType,
                        start: training.start,
                        end: training.end,
                        model_ids: training.modelIds ?? []
                    })
                ) */
            }
        })
    )

    return result
}

async function downloadWeights(project, trainingId, modelId) {

    //Obtém URL assinada
    const weightsUrl = await getWeightsUrl(modelId, project)

    //Faz download
    const savedPath = await saveWeights(weightsUrl, trainingId)

    return {
        training_id: trainingId,
        model_id: modelId,
        path:savedPath
    }
}

async function downloadVersion({project, version, format="yolo26", overwrite=true}) {

    const baseDirectory = path.resolve(process.env.ROBOFLOW_DATASETS_DIR ?? "../datasets/")

    const safeProject = safeLocalName(project);
    const safeVersion = safeLocalName(version);

    const destination = path.join(baseDirectory, safeProject)

    /*
     * Diretório temporário
     */
    const tempDirectory = path.join(baseDirectory, ".tmp")
    await fs.mkdir(tempDirectory, {recursive: true})

    const zipPath = path.join( tempDirectory, `${crypto.randomUUID()}.zip`)

    try {

        // 1. Solicita/aguarda exportação
        const downloadUrl = await waitForVersionExport(project, version, format)

        // 2. Baixa ZIP
        await downloadZip(downloadUrl, zipPath)

        // 3. Cria destino
        await fs.mkdir(destination, {recursive: true})

        // 4. Extrai
        await extractZip(zipPath, destination)

        // 4. Criar arquivo de versão do dataset
        const versionFilePath = path.join(destination, "version.json")
        await fs.writeFile(versionFilePath,
            JSON.stringify({version: Number(version)}, null, 4 ),
            "utf8"
        )

        return {
            project,
            version,
            format,
            path: destination,
            already_downloaded: false
        }

    } catch (error) {

        /*
         * Caso alguma coisa dê errado,
         * remove a pasta incompleta.
         */
        await fs.rm(destination, {recursive: true, force: true})
        throw error;

    } finally {

        /*
         * ZIP não é mais necessário.
         */
        await fs.rm(zipPath, {force: true})
    }
}

/*
!!!!!!!!!!!!!!!

AUXILIARY FUNCTIONS

!!!!!!!!!!!!!!!

*/

async function getLocalDatasetVersion(project) {
    const versionFile = path.join(
        process.env.ROBOFLOW_DATASETS_DIR,
        project,
        "version.json"
    )

    try {
        const content = await fs.readFile(versionFile, "utf8")
        const data = JSON.parse(content);
        return data.version;

    } catch {
        return null;
    }
}

async function roboflowRequest(endpoint) {
    const separator = endpoint.includes("?") ? "&" : "?"

    const url = `${roboflowConfig.apiUrl}${endpoint}` 
        +`${separator}api_key=` + encodeURIComponent(roboflowConfig.apiKey)

    const response = await fetch(url)

    let data

    try {
        data = await response.json()
    } catch {
        data = null
    }

    if (!response.ok) {
        const error = new Error(
            data?.error?.message ??
            data?.error ??
            "Erro ao acessar Roboflow"
        )

        error.code = "ROBOFLOW_ERROR"
        error.status = response.status

        throw error
    }

    return data
}

async function getProjectVersions(project) {
    const { workspace } = roboflowConfig

    const data = await roboflowRequest(
        `/${encodeURIComponent(workspace)}` +
        `/${encodeURIComponent(project)}`
    )

    return data.versions ?? []
}

async function getVersionTrainings(version, project) {
    const {workspace} = roboflowConfig

    const data = await roboflowRequest(
        `/${encodeURIComponent(workspace)}` +
        `/${encodeURIComponent(project)}` +
        `/${encodeURIComponent(version)}` +
        `/v2/trainings`
    )

    return data.trainings ?? []
}

async function getVersionExport(project, version, format) {
    const {workspace} = roboflowConfig

    return roboflowRequest(
        `/${encodeURIComponent(workspace)}` +
        `/${encodeURIComponent(project)}` +
        `/${encodeURIComponent(version)}` +
        `/${encodeURIComponent(format)}` +
        `?nocache=true`
    )
}

async function getWeightsUrl(modelId, project) {
    const {workspace} = roboflowConfig

    const modelIdString = String(modelId)

    const slashIndex = modelIdString.indexOf("/")

    const weightsId =
        slashIndex !== -1 ? modelIdString.substring(slashIndex + 1) : modelIdString

    const data = await roboflowRequest(
        `/${encodeURIComponent(workspace)}` +
        `/${encodeURIComponent(project)}` +
        `/${encodeURIComponent(weightsId)}` +
        `/ptFile`
    )

    if (!data.weightsUrl) {
        const error = new Error("Pesos não disponíveis")
        error.code = "WEIGHTS_NOT_AVAILABLE"
        throw error
    }

    return data.weightsUrl
}

async function saveWeights(weightsUrl, trainingId) {

    const safeTrainingId = String(trainingId)
        .replace(/[^a-zA-Z0-9._-]/g,"_")

    const baseDirectory = path.resolve(
            process.env.ROBOFLOW_MODELS_DIR ??
            "./models/roboflow"
    )

    const trainingDirectory = path.join(baseDirectory, safeTrainingId);
    await fs.mkdir( trainingDirectory, {recursive: true})

    const finalPath = path.join(trainingDirectory, "best.pt")

    const tempPath = `${finalPath}.part`
    const response = await fetch(weightsUrl)

    if ( !response.ok || !response.body) {
        const error = new Error("Falha ao baixar pesos")
        error.code = "WEIGHTS_NOT_AVAILABLE"
        throw error
    }

    try {

        const output = createWriteStream(tempPath)
        await pipeline(
            Readable.fromWeb(response.body),
            output
        )

        // Remover um best.pt anterior caso exista.
        await fs.rm(finalPath, {force: true})
        await fs.rename( tempPath, finalPath)

        return finalPath;

    } catch (error) {
        await fs.rm(tempPath, { force: true})
        throw error
    }
}

async function waitForVersionExport(project, version, format) {
    const maxAttempts = 300

    for (let attempt = 0; attempt < maxAttempts; attempt++) {
        const exportInfo = await getVersionExport(project, version, format)

        if (exportInfo.ready === false) {
            console.log(`Exportando dataset: ${Math.round((exportInfo.progress ?? 0) * 100)}%`)
            await sleep(2000)
            continue
        }

        const downloadUrl = exportInfo.export?.link

        if (downloadUrl) 
            return downloadUrl

        throw new Error("Roboflow não retornou o link de download")
    }

    const error = new Error("Timeout ao gerar exportação")
    error.code = "EXPORT_TIMEOUT";

    throw error;
}

async function downloadZip(downloadUrl, destination) {
    const response = await fetch(downloadUrl)

    if (!response.ok || !response.body) {
        const error = new Error("Falha ao baixar ZIP")
        error.code = "DOWNLOAD_ERROR"
        throw error
    }

    await pipeline(
        Readable.fromWeb(response.body),
        createWriteStream(destination)
    )
}

async function extractZip(zipPath, destination) {
    const zip = await unzipper.Open.file(zipPath)
    await zip.extract({ path: destination})
}

function sleep(ms) {
    return new Promise(resolve => setTimeout(resolve, ms))
}

async function exists(targetPath) {
    try {
        await fs.access(targetPath);
        return true;
    } catch {
        return false;
    }
}

function safeLocalName(value) {
    return String(value).replace(/[^a-zA-Z0-9._-]/g, "_")
}

module.exports = {
    getProjects,
    getProjectVersions,
    getVersionTrainings,
    getDatasetsAndTrainings,
    downloadWeights,
    downloadVersion
}