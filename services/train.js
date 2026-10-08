const fs = require("fs/promises")
const path = require("path")
const { spawn } = require("child_process")
const EventEmitter = require("events")

const datasetPath = path.resolve(process.cwd(), "../datasets")

var CURRENT_TRAIN_PID = null
var CURRENT_TRAIN_NAME = null
var CURRENT_VERSION_NAME = null

// idle, running, stopping, stopped, completed, error
var CURRENT_TRAIN_STATUS = "idle"

var STOP_REQUESTED = false

// Quantidade máxima de logs mantidos em memória
const MAX_LOG_ENTRIES = 2000

// Histórico de logs do treinamento atual
var TRAINING_LOGS = []

// EventEmitter responsável por enviar eventos
// do treinamento para o controller
const TRAINING_EVENTS = new EventEmitter()


async function startTraining(projectName) {

    // Impede mais de um treinamento simultâneo
    if (CURRENT_TRAIN_PID != null) {

        const error = new Error(
            `Já existe um treinamento em execução.`+
            `Projeto(${CURRENT_TRAIN_NAME}) e Dataset Version(${CURRENT_VERSION_NAME})`
        )
        error.code = "TRAINING_IN_EXECUTION"
        throw error
    }


    // Impede caminhos como ../../alguma-pasta
    const safeName = path.basename(projectName)

    if (safeName !== projectName) {

        const error = new Error("Nome de dataset inválido")
        error.code = "INVALID_DATASET_NAME"
        throw error
    }

    // Verifica se o dataset existe
    const selectedDatasetPath = path.join(datasetPath, safeName)

    try {

        const stats = await fs.stat(selectedDatasetPath)

        if (!stats.isDirectory()) {
            const error = new Error("Dataset padrão deste projeto não encontrado")
            error.code = "DATASET_NOT_FOUND"
            throw error
        }

    } catch (error) {

        if (error.code === "ENOENT") {
            const notFound = new Error("Dataset não encontrado")
            notFound.code = "DATASET_NOT_FOUND"
            throw notFound
        }

        throw error
    }

    // Verifica se o data.yaml existe
    const yamlPath = path.join(selectedDatasetPath,"data.yaml")

    try {
        await fs.access(yamlPath)
    } catch {
        const error = new Error("data.yaml não encontrado")
        error.code = "DATA_YAML_NOT_FOUND"
        throw error
    }

    const versionPath = path.join(selectedDatasetPath, "version.json");
    let datasetVersion = null

    try {
        const fileContent = await fs.readFile(versionPath, "utf-8")
        const data = JSON.parse(fileContent)
        datasetVersion = data.version
    } catch {
        const error = new Error("version.json não encontrado")
        error.code = "VERSION_JSON_NOT_FOUND"
        throw error
    }

    // Remove treinamento anterior
    await removePreviousTraining(safeName)

    // Caminho do script Python
    const pythonScript = path.resolve(process.cwd(), "python","train_yolo.py")

    // Limpa os logs do treinamento anterior
    TRAINING_LOGS = []
    STOP_REQUESTED = false

    // Inicia treinamento
    const processTraining = spawn(
        "python",
        [pythonScript, yamlPath, safeName],
        {stdio: ["ignore", "pipe", "pipe"]}
    )


    // Salva informações do processo atual
    CURRENT_TRAIN_PID = processTraining.pid
    CURRENT_TRAIN_NAME = safeName
    CURRENT_VERSION_NAME = datasetVersion
    CURRENT_TRAIN_STATUS = "running"


    // Informa ao frontend que o treinamento começou
    emitTrainingEvent({
        type: "status",
        status: "running",
        projectName: safeName,
        datasetVersion,
        pid: processTraining.pid
    })


    // Captura stdout do Python
    processTraining.stdout.on(
        "data",
        (data) => {
            const text = data.toString()
            console.log(`[YOLO - ${safeName}] ${text}`)
            addTrainingLog(safeName, datasetVersion, "stdout", text)
        }
    )


    // Captura stderr do Python
    processTraining.stderr.on(
        "data",
        (data) => {
            const text = data.toString()
            console.error(`[YOLO - ${safeName}] ${text}`)
            addTrainingLog(safeName, datasetVersion, "stderr", text)
        }
    )


    // Caso ocorra erro no processo
    processTraining.on(
        "error",
        (error) => {
            const message =`Erro no processo de treinamento: ${error.message}\n`
            console.error(message)
            addTrainingLog(safeName, datasetVersion, "stderr", message)

            if (CURRENT_TRAIN_PID === processTraining.pid) {
                CURRENT_TRAIN_PID = null
                CURRENT_TRAIN_NAME = null
                CURRENT_VERSION_NAME = null
                CURRENT_TRAIN_STATUS = "error"
                STOP_REQUESTED = false
            }

            emitTrainingEvent({
                type: "status",
                status: "error",
                projectName: safeName,
                datasetVersion,
                error: error.message
            })
        }
    )


    // Quando o processo finalizar
    processTraining.on(
        "close",
        async (code) => {
            const wasStopped = STOP_REQUESTED
            console.log(`Treinamento ${safeName} finalizado com código ${code}`)

            /*
                Caso tenha sido interrompido pelo usuário,
                remove a pasta do treinamento incompleto
            */
            if (wasStopped) {
                try {
                    await removePreviousTraining(safeName)
                } catch (error) {
                    addTrainingLog(
                        safeName,
                        datasetVersion,
                        "stderr",
                        `Erro ao remover treinamento interrompido: ${error.message}\n`
                    )
                }
            }

            /*
                Somente agora liberamos a execução
                de outro treinamento.

                Isso garante que o processo realmente
                terminou antes de CURRENT_TRAIN_PID
                voltar para null.
            */
            if (CURRENT_TRAIN_PID === processTraining.pid) {
                CURRENT_TRAIN_PID = null
                CURRENT_TRAIN_NAME = null
                CURRENT_VERSION_NAME = null
                STOP_REQUESTED = false
            }


            // Treinamento interrompido manualmente
            if (wasStopped) {
                CURRENT_TRAIN_STATUS = "stopped"
                emitTrainingEvent({
                    type: "status",
                    status: "stopped",
                    projectName: safeName,
                    datasetVersion,
                    code: code
                })

                return
            }


            // Treinamento finalizado normalmente
            if (code === 0) {
                CURRENT_TRAIN_STATUS ="completed"
                emitTrainingEvent({
                    type: "status",
                    status: "completed",
                    projectName: safeName,
                    datasetVersion,
                    code: code
                })

            } else {
                CURRENT_TRAIN_STATUS = "error"
                emitTrainingEvent({
                    type: "status",
                    status: "error",
                    projectName: safeName,
                    datasetVersion,
                    code: code
                })
            }
        }
    )


    return { pid: processTraining.pid}
}



async function stopTraining() {

    if (CURRENT_TRAIN_PID === null) {
        const error = new Error("Nenhum treinamento está em execução")
        error.code = "TRAINING_NOT_RUNNING"
        throw error
    }

    const pid = CURRENT_TRAIN_PID
    const projectName = CURRENT_TRAIN_NAME
    const datasetVersion = CURRENT_VERSION_NAME

    try {

        /*
            Marca que foi uma interrupção manual.

            O processo ainda continua considerado
            ativo até o evento "close".
        */
        STOP_REQUESTED = true
        CURRENT_TRAIN_STATUS = "stopping"

        emitTrainingEvent({
            type: "status",
            status: "stopping",
            projectName,
            datasetVersion,
            pid
        })


        /*
            Solicita encerramento do processo.
            Ele só será liberado no evento "close".
        */
        process.kill(pid, "SIGTERM")
        return true


    } catch (error) {

        /*
            Se não foi possível parar,
            continua considerando o treinamento
            em execução.
        */

        STOP_REQUESTED = false
        CURRENT_TRAIN_STATUS = "running"

        emitTrainingEvent({
            type: "status",
            status: "running",
            projectName,
            datasetVersion,
            pid
        })

        throw error
    }
}



// !!!!!!!!!!!!!!!!!!!!!!!!!!

// LOGS / EVENTOS PARA O FRONTEND

// !!!!!!!!!!!!!!!!!!!!!!!!!!


function addTrainingLog(projectName, datasetVersion, stream, text) {

    const log = {
        type: "log",
        projectName,
        datasetVersion,
        stream: stream,
        text: text,
        timestamp: new Date().toISOString()
    }

    TRAINING_LOGS.push(log)

    /*
        Impede que os logs cresçam
        indefinidamente na memória
    */
    if ( TRAINING_LOGS.length > MAX_LOG_ENTRIES) 
        TRAINING_LOGS.shift()

    emitTrainingEvent(log)
}

function emitTrainingEvent(event) {
    TRAINING_EVENTS.emit("training-event", event)
}

/*
    O controller usa essa função
    para receber eventos do treinamento.

    Retorna uma função unsubscribe
    para remover o listener quando
    o navegador desconectar.
*/
function subscribeTrainingEvents(listener) {
    TRAINING_EVENTS.on("training-event", listener)
    return () => {TRAINING_EVENTS.off("training-event", listener)}
}

/*
    Permite que o frontend consulte
    o estado atual do treinamento.

    Isso é útil quando a página
    é atualizada durante um treinamento.
*/
function getTrainingState() {

    return {
        running: CURRENT_TRAIN_PID !== null,
        pid: CURRENT_TRAIN_PID,
        projectName: CURRENT_TRAIN_NAME,
        datasetVersion: CURRENT_VERSION_NAME,
        status: CURRENT_TRAIN_STATUS,
        logs: [...TRAINING_LOGS]
    }
}

// !!!!!!!!!!!!!!!!!!!!!!!!!!

// AUXILIARY FUNCTIONS

// !!!!!!!!!!!!!!!!!!!!!!!!!!

async function removePreviousTraining(projectName) {

    const trainingPath = path.resolve(process.cwd(), "runs", "detect", projectName)

    try {
        await fs.rm(trainingPath, {recursive: true, force: true})
        console.log(`Treinamento anterior removido: ${trainingPath}`)
    } catch (error) {
        console.error("Erro ao remover treinamento anterior:", error)
        throw error
    }
}

module.exports = {
    startTraining,
    stopTraining,
    subscribeTrainingEvents,
    getTrainingState,
    removePreviousTraining
}