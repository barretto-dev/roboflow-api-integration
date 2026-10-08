const requiredVariables = ["ROBOFLOW_API_KEY", "ROBOFLOW_WORKSPACE"]

for (const variable of requiredVariables) {
    if (!process.env[variable])
        throw new Error(`Variável de ambiente ${variable} não definida`)
}

const roboflowConfig = {
    apiKey: process.env.ROBOFLOW_API_KEY,
    workspace: process.env.ROBOFLOW_WORKSPACE,
    apiUrl:
        process.env.ROBOFLOW_API_URL ??
        "https://api.roboflow.com"
}

module.exports = roboflowConfig;