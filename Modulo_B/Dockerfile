FROM python:3.14-slim

WORKDIR /code

COPY requirements.txt .

RUN pip install --no-cache-dir -r requirements.txt

COPY ./src ./src

EXPOSE 5000

CMD ["fastapi", "run", "src/main.py", "--host", "0.0.0.0", "--port", "5000"]