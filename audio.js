window.AudioContext = webkitAudioContext;

window.AudioBuffer = new AudioContext().createBuffer(0, 0, 0).constructor;

function AudioBufferSampleSource(audioBuffer) {
    this._audioBuffer = audioBuffer;
}

AudioBufferSampleSource.prototype = {
    extract: function (target, length, startPosition) {
        return this._audioBuffer.extract(target, length, startPosition);
    },

    toSourcePosition: function (position) {
        return position;
    },

    get length() {
        return this._audioBuffer.length;
    }
};

function RangeSampleSource(source, offset, length) {
    this.source = source;
    this._offset = offset;
    this._length = length;
}

RangeSampleSource.prototype = {
    extract: function (target, length, startPosition) {
        if (!startPosition) {
            startPosition = 0;
        }
        length = Math.min(length, this._length - startPosition);
        return this.source.extract(target, length, this._offset + startPosition);
    },

    toSourcePosition: function(position) {
        return this._offset + position;
    },

     get offset() {
        return this._offset;
    },

    get length() {
        return this._length;
    }
};

function SampleSourceNode(context, bufferSize) {
    this.playing = false;
    this._offset = 0;
    this._jsNode = context.createJavaScriptNode(bufferSize, 0, 1);

    var finished = false;

    this._jsNode.onaudioprocess = _.bind(function (e) {
        if (finished) {
            return;
        }
        var length = this._sampleSource.extract(e.outputBuffer, bufferSize, this._offset);

        if (length < bufferSize) {
            finished = true;
            // TODO wait for context to play
            if (this.onfinish) {
                this.onfinish();
            }
        }
        this._offset += bufferSize;
    }, this);

    this.positionOffset = 0;
}

SampleSourceNode.prototype = {
    set sampleSource(sampleSource) {
        this._sampleSource = sampleSource;
    },

     connect: function () {
         this._jsNode.connect.apply(this._jsNode, arguments);
         if (!this.playing) {
             this.positionOffset = this.context.currentTime;
         }
         this.playing = true;
    },

    disconnect: function () {
        this._jsNode.disconnect.apply(this._jsNode, arguments);
        this.playing = false;
    },

    get context() {
        return this._jsNode.context;
    },

    get numberOfInputs() {
        return this._jsNode.numberOfInputs;
    },

    get numberOfOutputs() {
        return this._jsNode.numberOfOutputs;
    },

    get bufferSize() {
        return this._jsNode.bufferSize;
    },

    get position() {
        // TODO don't hardcode sample rate
        return Math.floor((this.context.position - this.positionOffset) * 44.1);
    },

    get sourcePosition() {
      return this._sampleSource.toSourcePosition(position);
    },

    get sourceLength() {
      return this._sampleSource.length;
    }
};

function SampleSourcePlayer(context, bufferSize) {
    this._node = new SampleSourceNode(context, bufferSize);
    this._node.onfinish = _.bind(this.stop, this);
    this._context = context;
}

SampleSourcePlayer.prototype = {
    set sampleSource(sampleSource) {
        this._node.sampleSource = sampleSource;
    },

     start: function () {
         this._node.connect(this._context.destination);
    },

    stop: function () {
      this._node.disconnect();
    }
};

function SourceListItem() {};

SourceListItem.prototype = {
    toSourcePosition: function (position) {
        return this.source.toSourcePosition(position - this.startOffset);
    },

    extract: function (target, length, startPosition) {
        return this.source.extract(target, length, startPosition - this.startOffset);
    }
};

function SourceList(sources) {
    this._length = 0;
    this._sources = [];
    var index = 0;
    _.each(sources, function (item) {
        var s = new SourceListItem();
        s.startOffset = this._length;
        this._length += item.length;
        s.endOffset = this._length;
        s.length = item.length;
        s.source = item;
        s.index = index++;

        this._sources.push(s);
    }, this);

    this.sli = this._sources[0];
    this.positionSli = this.sli;

    this.outputPosition = 0;
}

SourceList.prototype = {
    extract: function(target, length, startPosition) {
        if (_.isUndefined(startPosition)) {
            if (startPosition != this.outputPosition) {
                this.outputPosition = startPosition;
                this.sli = seek(this.outputPosition, this.sli);
            }
        }

        var framesRead = 0;
        while (!this.finished && framesRead < length) {
            var framesLeft = this.sli.endOffset - this.outputPosition;
            var framesToRead = Math.min(framesLeft, length - framesRead);
            var currentFramesRead = this.sli.extract(target, framesToRead, this.outputPosition);
            target = target.slice(currentFramesRead);

            framesRead += framesToRead;
            this.outputPosition += framesToRead;
            if (this.outputPosition == this.sli.endOffset) {

                if (this.sli.index == this._sources.length - 1) {
                    this.finished = true;
                }
                else {
                    this.sli = this._sources[this.sli.index + 1];
                }
            }
        }
        return framesRead;
    },

    toSourcePosition: function(position) {
        this.positionSli = seek(position, this.positionSli);
        return this.positionSli.toSourcePosition(position);
    },

    getSource: function(position) {
        this.positionSli = this.seek(position, this.positionSli);
        return {index: this.positionSli.index, position: this.positionSli.toSourcePosition(position)};
    },

    seek: function(position, seekSli) {
        while (position > seekSli.endOffset) {
            seekSli = this._sources[seekSli.index + 1];
        }
        while (position < seekSli.startOffset) {
            seekSli = this._sources[seekSli.index - 1];
        }

        return seekSli;
    },

    get length() {
        return this._length;
    },

    get sampleSourceIndex() {
        return this.positionSli.index;
    }
};
