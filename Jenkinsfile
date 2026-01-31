@Library('homelab') _

pipeline {
    agent {
        kubernetes {
            yaml homelab.podTemplate('node')
        }
    }

    options {
        timeout(time: 10, unit: 'MINUTES')
        buildDiscarder(logRotator(numToKeepStr: '10'))
        disableConcurrentBuilds()
    }

    stages {
        stage('Setup') {
            steps {
                container('node') {
                    // Configure npm to use Nexus for @erauner packages
                    withCredentials([string(credentialsId: 'nexus-npm-token', variable: 'NPM_TOKEN')]) {
                        sh '''
                            echo "//npm.nexus.erauner.dev/repository/npm-hosted/:_authToken=${NPM_TOKEN}" >> .npmrc
                        '''
                    }
                }
            }
        }

        stage('Install') {
            steps {
                container('node') {
                    sh 'npm ci'
                }
            }
        }

        stage('Build') {
            steps {
                container('node') {
                    sh 'npm run build'
                }
            }
        }

        stage('Test') {
            steps {
                container('node') {
                    sh 'npm test || echo "No tests yet"'
                }
            }
        }
    }

    post {
        success {
            script {
                homelab.githubStatus('SUCCESS', 'Build passed')
            }
        }
        failure {
            script {
                homelab.githubStatus('FAILURE', 'Build failed')
                homelab.postFailurePrComment([repo: 'erauner/homelab-obsidian-tools'])
                homelab.notifyDiscordFailure()
            }
        }
    }
}
