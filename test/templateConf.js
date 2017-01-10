// Config file for aws-s3-deploy

module.exports = {
    test: {
        google: {
            client_id: '932020179419-jj05sbi05en9f1naog1sng63o2640un5',
            client_secret: 'UnG4nmAZohgO8vOyQEMIkYQG'
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
