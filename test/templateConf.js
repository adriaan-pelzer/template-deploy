// Config file for aws-s3-deploy

module.exports = {
    test: {
        google: {
            client_id: '',
            client_secret: ''
        },
        apiUrl: 'http://localhost:5000',
        Omit: [
            'templateConf.js'
        ],
        data: {
            publicUrl: 'http://localhost:3000'
        }
    }
}
