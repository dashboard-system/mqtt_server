const express = require('express')
const router = express.Router()
const { UCIService } = require('../services/uciService')

// Initialize UCI service
const uciService = new UCIService()

// Middleware to pass dependencies to service
router.use((req, res, next) => {
  uciService.setMQTTClient(req.app.locals.mqttClient)
  uciService.setLogger(req.app.locals.logger)
  next()
})

// UCI Files endpoints
router.get('/files', async (req, res) => {
  try {
    const result = await uciService.listUCIFiles()
    res.json(result)
  } catch (error) {
    res.status(500).json({
      error: error.message,
      timestamp: new Date().toISOString(),
    })
  }
})

router.get('/files/:fileName', async (req, res) => {
  try {
    const { fileName } = req.params
    const result = await uciService.getUCIFile(fileName)
    res.json(result)
  } catch (error) {
    res.status(500).json({
      error: error.message,
      timestamp: new Date().toISOString(),
    })
  }
})

router.get('/files/:fileName/:sectionName', async (req, res) => {
  try {
    const { fileName, sectionName } = req.params
    const result = await uciService.getUCISections(fileName, sectionName)
    res.json(result)
  } catch (error) {
    res.status(500).json({
      error: error.message,
      timestamp: new Date().toISOString(),
    })
  }
})

router.get('/files/:fileName/:sectionName/:uuid', async (req, res) => {
  try {
    const { fileName, sectionName, uuid } = req.params
    const result = await uciService.getUCISection(fileName, sectionName, uuid)

    if (!result.section) {
      return res.status(404).json({
        error: 'Section not found',
        fileName,
        sectionName,
        uuid,
        timestamp: new Date().toISOString(),
      })
    }

    res.json(result)
  } catch (error) {
    res.status(500).json({
      error: error.message,
      timestamp: new Date().toISOString(),
    })
  }
})

// UCI Management endpoints
router.post('/files/:fileName/:sectionName', async (req, res) => {
  try {
    const { fileName, sectionName } = req.params
    const { values } = req.body

    if (!values || typeof values !== 'object') {
      return res.status(400).json({
        error: 'Invalid request body. Expected "values" object.',
        timestamp: new Date().toISOString(),
      })
    }

    const result = await uciService.createUCISection(
      fileName,
      sectionName,
      values,
    )
    res.status(202).json(result)
  } catch (error) {
    res.status(500).json({
      error: error.message,
      timestamp: new Date().toISOString(),
    })
  }
})

router.put('/files/:fileName/:sectionName/:uuid', async (req, res) => {
  try {
    const { fileName, sectionName, uuid } = req.params
    const { values } = req.body

    if (!values || typeof values !== 'object') {
      return res.status(400).json({
        error: 'Invalid request body. Expected "values" object.',
        timestamp: new Date().toISOString(),
      })
    }

    const result = await uciService.updateUCISection(
      fileName,
      sectionName,
      uuid,
      values,
    )
    res.json(result)
  } catch (error) {
    res.status(500).json({
      error: error.message,
      timestamp: new Date().toISOString(),
    })
  }
})

router.delete('/files/:fileName/:sectionName/:uuid', async (req, res) => {
  try {
    const { fileName, sectionName, uuid } = req.params
    const result = await uciService.deleteUCISection(
      fileName,
      sectionName,
      uuid,
    )
    res.json(result)
  } catch (error) {
    res.status(500).json({
      error: error.message,
      timestamp: new Date().toISOString(),
    })
  }
})

router.post('/reload/:fileName', async (req, res) => {
  try {
    const { fileName } = req.params
    const result = await uciService.reloadUCIFile(fileName)
    res.json(result)
  } catch (error) {
    res.status(500).json({
      error: error.message,
      timestamp: new Date().toISOString(),
    })
  }
})

module.exports = router
