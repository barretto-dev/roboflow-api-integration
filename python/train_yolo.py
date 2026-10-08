import sys
from ultralytics import YOLO


def train(dataset_yaml, dataset_name):

    print(f"Iniciando treinamento do dataset: {dataset_name}")
    print(f"Dataset YAML: {dataset_yaml}")

    model = YOLO("yolo26n.pt")

    model.train(
        data=dataset_yaml,
        epochs=10,
        imgsz=640,
        batch=8,
        patience=20,
        device="cpu",
        cache="disk",
        freeze=10,
        name=dataset_name
    )


if __name__ == "__main__":

    if len(sys.argv) < 3:
        print("Dataset não informado")
        sys.exit(1)

    dataset_yaml = sys.argv[1]
    dataset_name = sys.argv[2]

    train(
        dataset_yaml,
        dataset_name
    )