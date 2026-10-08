const multer = require("multer");
const path = require("path");

const uploadPath = path.resolve(
    process.cwd(),
    "tmp",
    "uploads"
);

const upload = multer({
    dest: uploadPath,

    limits: {
        // máximo de 2 GB
        fileSize: 2 * 1024 * 1024 * 1024
    },

    fileFilter: (req, file, callback) => {
        const extension = path
            .extname(file.originalname)
            .toLowerCase();

        if (extension !== ".zip") 
            return callback(new Error("Apenas arquivos ZIP são permitidos"));

        callback(null, true);
    }
});

function receiveDatasetZip(req, res) {
    return new Promise((resolve, reject) => {
        upload.single("file")(req, res, (error) => {
            if (error) 
                return reject(error)
            
            resolve()
        });
    });
}

module.exports = {
    receiveDatasetZip
};