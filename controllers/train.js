const {
    startTraining,
    stopTraining,
    subscribeTrainingEvents,
    getTrainingState
} = require("../services/train.js");

async function startTrainDataset(req, res) {
    try {
        const { datasetName } = req.params;

        const training = await startTraining(datasetName);

        return res.status(202).json({
            message: "Treinamento iniciado",
            dataset: datasetName,
            pid: training.pid
        });

    } catch (error) {
        console.error(error);

        if (error.code === "INVALID_DATASET_NAME")
            return res.status(400).json({message: "Nome de dataset inválido"})

        if (error.code === "TRAINING_IN_EXECUTION")
            return res.status(400).json({message: error.message})

        if (error.code === "DATASET_NOT_FOUND") 
            return res.status(404).json({message: "Dataset não encontrado"})
        
        if (error.code === "VERSION_JSON_NOT_FOUND")
            return res.status(404).json({message: "O arquivo version.json não foi encontrado no dataset"})

        if (error.code === "DATA_YAML_NOT_FOUND") 
            return res.status(400).json({message: "O arquivo data.yaml não foi encontrado no dataset"})

        return res.status(500).json({message: "Erro ao iniciar treinamento"})
    }
}

async function stopTrainDataset(req, res) {
    try {
        const result = await stopTraining();

        return res.status(200).json({
            message: "Treinamento encerrado",
            pid: result.pid
        });

    } catch (error) {
        if (error.code === "TRAINING_NOT_RUNNING")
            return res.status(409).json({message: "Nenhum treinamento está em execução"});

        console.error(error);
        return res.status(500).json({message: "Erro ao encerrar treinamento"});
    }
}

function trainingEvents(req, res) {

    //Headers necessários para SSE
    res.setHeader("Content-Type", "text/event-stream")
    res.setHeader("Cache-Control", "no-cache")
    res.setHeader("Connection", "keep-alive")

    //Evita buffering em alguns proxies,como Nginx.
    res.setHeader("X-Accel-Buffering", "no")

    //Envia imediatamente os headers.
    res.flushHeaders();


    /*
        Recupera o estado atual.

        Isso é importante caso o usuário abra
        ou atualize a página enquanto o treinamento
        já estiver acontecendo.
    */
    const currentState = getTrainingState();

    //Primeiro evento enviado ao frontend: snapshot do estado atual.
    res.write(
        `event: snapshot\n` +
        `data: ${JSON.stringify(currentState)}\n\n`
    )

    /*
        Escuta novos eventos gerados pelo service.
    */
    const unsubscribe = subscribeTrainingEvents(
        (event) => {
            res.write(
                `event: training\n` +
                `data: ${JSON.stringify(event)}\n\n`
            )
        }
    )

    /*
        Quando o navegador fechar a página
        ou encerrar o EventSource, removemos
        o listener.
    */
    req.on("close", () => {

        unsubscribe();
        console.log("Frontend desconectado dos logs de treinamento");
    });
}

module.exports = {
    startTrainDataset,
    stopTrainDataset,
    trainingEvents
};