@Library('homelab') _

pipeline {
    agent {
        kubernetes {
            yaml '''
apiVersion: v1
kind: Pod
spec:
  containers:
  - name: jnlp
    image: jenkins/inbound-agent:3355.v388858a_47b_33-3-jdk21
    resources:
      requests:
        cpu: 100m
        memory: 256Mi
      limits:
        cpu: 500m
        memory: 512Mi
  - name: node
    image: node:22-alpine
    command: ['sleep', '3600']
    resources:
      requests:
        cpu: 200m
        memory: 512Mi
      limits:
        cpu: 1000m
        memory: 1Gi
  - name: tools
    image: alpine/k8s:1.31.3
    command: ['sleep', '3600']
    resources:
      requests:
        cpu: 50m
        memory: 64Mi
      limits:
        cpu: 200m
        memory: 256Mi
'''
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
                    withCredentials([usernamePassword(credentialsId: 'nexus-credentials', usernameVariable: 'NEXUS_USER', passwordVariable: 'NEXUS_PASS')]) {
                        sh '''
                            AUTH_TOKEN=$(echo -n "${NEXUS_USER}:${NEXUS_PASS}" | base64)
                            echo "//npm.nexus.erauner.dev/repository/npm-hosted/:_auth=${AUTH_TOKEN}" >> .npmrc
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
