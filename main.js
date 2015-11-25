'use strict';

let fs = require('fs'),
    _ = require('lodash'),
    EventEmitter = require('events').EventEmitter;

const defaultOptions = {
  readOld: false,
  async: false,
  separator: '\n'.charCodeAt(0),
  // Size of data chunk to process in single run.
  chunkSize: 65536
};

class Tailer extends EventEmitter {
  /**
   * Constructs Tailer.
   * @param {String} file Path to file that should be tail'ed.
   * @param {Object} options
   * @return {undefined}
   */
  constructor (file, options) {
    // Invoke `EventEmitter` constructor.
    super();
    // Set few options.
    this.file = file;
    this.options = _.defaults({}, options, defaultOptions);

    if (_.isString(this.options.separator) && this.options.separator.length !== 1) {
      throw new Error('`options.separator` should be exactly 1 character long.');
    } else if (_.isString(this.options.separator)) {
      this.options.separator = this.options.separator.charCodeAt(0);
    }

    // Decide on reader starting position.
    if (this.options.readOld) {
      this.position = 0;
    } else {
      this.position = fs.statSync(file).size;
    }

    // Create our internal storage buffer.
    this.internalBuffer = new Buffer(0);

    // Line buffer.
    this.lineBuffer = '';

    // Initiate read strem
    this.recreateStream();

    // Watch for file changes.
    fs.watchFile(file, (curr, prev) => {
      // If file size shrunk, means that in was probably overwritten. Start from beginning.
      if (curr.size < prev.size) {
        this.position = 0;
      }

      // If we are already creating a stream, exit.
      if (this.creatingStream) {
        return;
      }

      // Create the stream with `curr.size` as end position.
      this.recreateStream(curr.size);
    });
  }

  /**
   * Emits `data` event in syncronous fashion.
   * @param {String} data Data to emit.
   * @return {undefined}
   */
  _emitSync (data) {
    this.emit('data', data);
  };

  /**
   * Emits `data` event in asyncronous fashion.
   * @param {String} data Data to emit.
   * @return {undefined}
   */
  _emitAsync (data) {
    setImmediate(() => {
      this.emit('data', data);
    });
  };

  /**
   * Processes internal buffer.
   * It separate from `stream`'s `data` callback, to be sure that we will not mix the data.
   * Data mixing can happen if we process buffer slower than it is being read.
   * @return {undefined}
   */
  processInternalBuffer () {
    let data;
    if (this.processingInternal) {
      // Return if processing is already going on.
      return;
    }

    this.processingInternal = true;

    // Get data slice to process.
    data = this.internalBuffer.slice(0, Math.min(this.internalBuffer.length, this.options.chunkSize));

    // Update internal buffer with data slice removed.
    this.internalBuffer = this.internalBuffer.slice(Math.min(this.internalBuffer.length, this.options.chunkSize));

    // Loop through data.
    for (let item of data) {
      if (item !== this.options.separator) {
        // If char is not a separator, add to line buffer.
        this.lineBuffer += String.fromCharCode(item);
      } else {
        // Reached end of line. Emit data we collected in `lineBuffer`. We also hard-copy it.
        this[(this.options.async ? '_emitAsync' : '_emitSync')]('' + this.lineBuffer);

        // Empty out line buffer.
        this.lineBuffer = '';
      }

      // Increase the current position.
      this.position++;
    }

    this.processingInternal = false;

    if (this.internalBuffer.length > 0) {
      // If buffer is not empty, shcedule its processing.
      setImmediate(this.internalBuffer.bind(this));
    }
  };

  /**
   * Re-creates stream, and stars reading the file.
   * @param {Number} end Position to read to.
   * @return {undefined}
   */
  recreateStream (end) {
    this.creatingStream = true;

    // Create new instance of readable stream.
    this.stream = fs.createReadStream(this.file, {
      start: this.position,
      end: end
    });

    // Bind listeners.
    this.stream.on('data', this.read.bind(this));
    this.stream.on('end', this.processInternalBuffer.bind(this));

    this.creatingStream = false;
  };

  read (data) {
    // Append data to internal buffer.
    this.internalBuffer = Buffer.concat([this.internalBuffer, data]);
    // Kick off processing of internal buffer.
    this.processInternalBuffer();
  };
}

module.exports = Tailer;
