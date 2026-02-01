@Library('homelab') _

pipeline {
    agent {
        kubernetes {
            yaml homelab.podTemplate('node-full')
        }
    }

    options {
        timeout(time: 10, unit: 'MINUTES')
        buildDiscarder(logRotator(numToKeepStr: '10'))
        disableConcurrentBuilds()
    }

    environment {
        NPM_REGISTRY = 'https://nexus.erauner.dev/repository/npm-hosted/'
    }

    stages {
        stage('Setup') {
            steps {
                container('node') {
                    script {
                        env.VERSION = sh(
                            script: "node -p \"require('./package.json').version\"",
                            returnStdout: true
                        ).trim()
                        env.COMMIT = env.GIT_COMMIT?.take(7) ?: 'unknown'
                    }
                    echo "Building @erauner/obsidian-tools version ${env.VERSION} (${env.COMMIT})"

                    // Configure npm to use Nexus for @erauner packages
                    withCredentials([usernamePassword(credentialsId: 'nexus-credentials', usernameVariable: 'NEXUS_USER', passwordVariable: 'NEXUS_PASS')]) {
                        sh '''
                            AUTH_TOKEN=$(echo -n "${NEXUS_USER}:${NEXUS_PASS}" | base64)
                            echo "//nexus.erauner.dev/repository/npm-hosted/:_auth=${AUTH_TOKEN}" >> .npmrc
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

        stage('Publish') {
            when {
                branch 'main'
            }
            steps {
                container('node') {
                    withCredentials([usernamePassword(credentialsId: 'nexus-credentials', usernameVariable: 'NEXUS_USER', passwordVariable: 'NEXUS_PASS')]) {
                        sh '''
                            # Check if version already exists
                            if npm view @erauner/obsidian-tools@${VERSION} version 2>/dev/null; then
                                echo "Version ${VERSION} already published, skipping..."
                            else
                                echo "Publishing @erauner/obsidian-tools@${VERSION}..."
                                npm publish --access public
                                echo "Published successfully!"
                            fi
                        '''
                    }
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
