pipeline {
    agent any

    options {
        timestamps()
        disableConcurrentBuilds()
    }

    environment {
        APP_IMAGE = 'daily-task-planner:ci'
        DOCKERHUB_REPO = 'daily-task-planner'
        APP_CONTAINER = 'daily-task-planner-ci'
        APP_VOLUME = 'daily-task-planner-ci-data'
        APP_PORT = '3001'
    }

    stages {
        stage('Checkout') {
            steps {
                checkout scm
            }
        }

        stage('Build Docker image') {
            steps {
                sh 'docker build -t "$APP_IMAGE" -f daily-task-planner-3/backend/Dockerfile daily-task-planner-3'
            }
        }

        stage('Push to Docker Hub') {
            steps {
                withCredentials([usernamePassword(
                    credentialsId: 'dockerhub-creds',
                    usernameVariable: 'DOCKERHUB_USER',
                    passwordVariable: 'DOCKERHUB_TOKEN'
                )]) {
                    sh '''
                        set +x
                        trap 'docker logout >/dev/null 2>&1 || true' EXIT
                        IMAGE_REF="$DOCKERHUB_USER/$DOCKERHUB_REPO:$BUILD_NUMBER"
                        echo "$DOCKERHUB_TOKEN" | docker login --username "$DOCKERHUB_USER" --password-stdin
                        docker tag "$APP_IMAGE" "$IMAGE_REF"
                        docker tag "$APP_IMAGE" "$DOCKERHUB_USER/$DOCKERHUB_REPO:latest"
                        docker push "$IMAGE_REF"
                        docker push "$DOCKERHUB_USER/$DOCKERHUB_REPO:latest"
                    '''
                }
            }
        }

        stage('Deploy test container') {
            steps {
                withCredentials([usernamePassword(
                    credentialsId: 'dockerhub-creds',
                    usernameVariable: 'DOCKERHUB_USER',
                    passwordVariable: 'DOCKERHUB_TOKEN'
                ),
                string(credentialsId: 'gmail-smtp-user', variable: 'SMTP_USER'),
                string(credentialsId: 'gmail-app-password', variable: 'SMTP_APP_PASSWORD'),
                string(credentialsId: 'planner-email-from', variable: 'EMAIL_FROM'),
                string(credentialsId: 'planner-public-url', variable: 'APP_BASE_URL')]) {
                    sh '''
                        set +x
                        IMAGE_REF="$DOCKERHUB_USER/$DOCKERHUB_REPO:$BUILD_NUMBER"
                        docker rm -f "$APP_CONTAINER" 2>/dev/null || true
                        docker run -d \
                          --name "$APP_CONTAINER" \
                          --restart unless-stopped \
                          -p "127.0.0.1:$APP_PORT:3000" \
                          -v "$APP_VOLUME:/app/backend/data" \
                          -e SMTP_USER \
                          -e SMTP_APP_PASSWORD \
                          -e EMAIL_FROM \
                          -e APP_BASE_URL \
                          "$IMAGE_REF"
                    '''
                }
            }
        }

        stage('Health check') {
            steps {
                sh '''
                    for attempt in $(seq 1 30); do
                      if curl --fail --silent "http://localhost:$APP_PORT/api/health"; then
                        echo
                        exit 0
                      fi
                      sleep 2
                    done
                    echo "Health check failed. Container logs:"
                    docker logs "$APP_CONTAINER"
                    exit 1
                '''
            }
        }
    }

    post {
        success {
            echo "Test deployment is available on the Jenkins agent at port ${APP_PORT}."
        }
        failure {
            echo 'Pipeline failed. Check the stage logs and the test container logs.'
        }
    }
}
