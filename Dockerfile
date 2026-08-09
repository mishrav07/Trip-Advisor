# Dockerfile to add the necessary dependencies for the project
FROM python:3.9-slim
# Set the working directory
WORKDIR /app
# Copy the requirements file into the container
COPY requirements.txt .
# Install the dependencies
RUN pip install --no-cache-dir -r requirements.txt
RUN apt-get update && apt-get install -y \
    build-essential \
    libpq-dev \
    && rm -rf /var/lib/apt/lists/*

# Copy the rest of the application code into the container
COPY . .
# Expose the port the app runs on
EXPOSE 5000
# Set the command to run the application
CMD ["uvicorn", "app:app", "--host", "0.0.0.0", "--port", "8000"]
## Note: Make sure to create a requirements.txt file with all the necessary dependencies for your project.