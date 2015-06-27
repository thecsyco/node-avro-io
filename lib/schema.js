var libpath = process.env['MOCHA_COV'] ? __dirname + '/../lib-cov/' : __dirname + '/';

var _ = require('lodash');
var util = require('util');
var AvroErrors = require(libpath + 'errors.js');

var PRIMITIVE_TYPES = ['null', 'boolean', 'int', 'long', 'float', 'double', 'bytes', 'string'];
var COMPLEX_TYPES = ['record', 'enum', 'array', 'map', 'union', 'fixed'];

var _parseNamedType = function(schema, namespace) {
    if (_.contains(PRIMITIVE_TYPES, schema)) {
        return schema;
    } else {
        throw new AvroErrors.InvalidSchemaError('unknown type name: %s; known type names are ',
                                         JSON.stringify(schema),
                                         JSON.stringify(_.keys(_namedTypes)));
    }
};

function makeFullyQualifiedTypeName(schema, namespace) {
    var typeName = null;
    if (_.isString(schema)) {
        typeName = schema;
    } else if (_.isObject(schema)) {
        if (_.isString(schema.namespace)) {
            namespace = schema.namespace;
        }
        if (_.isString(schema.name)) {
            typeName = schema.name;
        } else if (_.isString(schema.type)) {
            typeName = schema.type;
        }
    } else {
        throw new AvroErrors.InvalidSchemaError('unable to determine fully qualified type name from schema %s in namespace %s',
                                         JSON.stringify(schema), namespace);
    }

    if (!_.isString(typeName)) {
        throw new AvroErrors.InvalidSchemaError('unable to determine type name from schema %s in namespace %s',
                                         JSON.stringify(schema), namespace);
    }

    if (typeName.indexOf('.') !== -1) {
        return typeName;
    } else if (_.contains(PRIMITIVE_TYPES, typeName)) {
        return typeName;
    } else if (_.isString(namespace)) {
        return namespace + '.' + typeName;
    } else {
        return typeName;
    }
}

function Schema(schema, namespace) {

    if ((this instanceof arguments.callee) === false)
        return new arguments.callee(schema, namespace);

    if (!_.isUndefined(schema))
        return this.parse(schema, namespace);
}

_.extend(Schema.prototype, {

    parse: function(schema, namespace) {
        var self = this;
        if (_.isNull(schema) || _.isUndefined(schema)) {
            throw new AvroErrors.InvalidSchemaError('schema is null, in parentSchema: %s',
                                             JSON.stringify(parentSchema));
        } else if (_.isString(schema)) {
            return new PrimitiveSchema(schema);
        } else if (_.isObject(schema) && !_.isArray(schema)) {
            if (schema.type === 'record') {
                if (!_.has(schema, 'fields')) {
                    throw new AvroErrors.InvalidSchemaError('record must specify "fields", got %s',
                                                     JSON.stringify(schema));
                } else if (!_.has(schema, 'name')) {
                    throw new AvroErrors.InvalidSchemaError('record must specify "name", got %s',
                                                     JSON.stringify(schema));
                } else {
                    return new RecordSchema(schema.name, schema.namespace,
                                            _.map(schema.fields, function(field) {
                                                return new FieldSchema(field.name, self.parse(field, namespace), field.default);
                                            }));
                }
            } else if (schema.type === 'enum') {
                if (_.has(schema, 'symbols')) {
                    return new EnumSchema(schema.symbols);
                } else {
                    throw new AvroErrors.InvalidSchemaError('enum must specify "symbols", got %s',
                                                     JSON.stringify(schema));
                }
            } else if (schema.type === 'array') {
                if (_.has(schema, 'items')) {
                    return new ArraySchema(this.parse(schema.items, namespace), namespace, schema.default);
                } else {
                    throw new AvroErrors.InvalidSchemaError('array must specify "items", got %s',
                                                     JSON.stringify(schema));
                }
            } else if (schema.type === 'map') {
                if (_.has(schema, 'values')) {
                    return new MapSchema(this.parse(schema.values, namespace), schema.default);
                } else {
                    throw new AvroErrors.InvalidSchemaError('map must specify "values" schema, got %s',
                                                     JSON.stringify(schema));
                }
            } else if (schema.type === 'fixed') {
                if (_.has(schema, 'size')) {
                   return new FixedSchema(schema.name, schema.size);
                } else {
                    throw new AvroErrors.InvalidSchemaError('fixed must specify "size", got %s',
                                                         JSON.stringify(schema));
                }
            } else if ( _.isArray( schema.type ) ) {
                if (_.isEmpty(schema.type)) {
                    throw new AvroErrors.InvalidSchemaError('unions must have at least 1 branch');
                }
                var schemaTypes = _.clone( schema.type );
                var branchTypes = _.map(schemaTypes, function(type) {
                    schema.type = type;
                    return self.parse( schema, namespace);
                });
                return new UnionSchema(branchTypes, namespace, schema.default);
            } else if (_.has(schema, 'type')) {
                return this.parse(schema.type, namespace);
            } else {
                throw new AvroErrors.InvalidSchemaError('not yet implemented: %j', schema);
            }
        } else if (_.isArray(schema)) {
            if (_.isEmpty(schema)) {
                throw new AvroErrors.InvalidSchemaError('unions must have at least 1 branch');
            }
            var branchTypes = _.map(schema, function(type) {
                return self.parse( type, namespace);
            });
            return new UnionSchema(branchTypes, namespace, schema.default);
        } else {
            throw new AvroErrors.InvalidSchemaError('unexpected Javascript type for schema: ' + (typeof schema));
        }
    },

    validateAndThrow: function(schema, datum, path){
        // primitive types
        switch (schema) {
            case 'null':
                if (!_.isNull(datum))
                    throw new AvroErrors.DataValidationError("Data [%j] is not null. Path [%j]", datum, path);
                break;
            case 'boolean':
                if (!_.isBoolean(datum))
                    throw new AvroErrors.DataValidationError("Data [%j] is not boolean. Path [%j]", datum, path);
                break;
            case 'int':
            case 'long':
            case 'float':
            case 'double':
                if (!_.isNumber(datum) || datum === null)
                    throw new AvroErrors.DataValidationError("Data [%j] is not a number or not defined. Path %j", datum, path);
                break;
            case 'bytes':
                if (datum === null)
                    throw new AvroErrors.DataValidationError("Data [%j] not defined. Path [%j]", datum, path);
                break;
            case 'string':
                if (!_.isString(datum))
                    throw new AvroErrors.DataValidationError("Data [%j] is not a string. Path [%j]", datum, path);
                break;
            case 'enum':
                if (datum === null || _.indexOf(this.symbols, datum) === -1)
                    throw new AvroErrors.DataValidationError("Data [%j] not a valid enum value. List of valuies [%j]. Path [%j]", datum, this.symbols, path);
                break;
            case 'array':
                if (datum === null || !Array.isArray(datum))
                    throw new AvroErrors.DataValidationError("Data [%j] not a an array. Path [%j]", datum, this.symbols, path);
                break;
            case 'record':
                if (datum === null)
                    return false;
                var fields = _.pluck(this.fields, 'name');
                var dFields = _.keys(datum);
                var intersect = _.intersection(fields, dFields);
                if (intersect.length < dFields.length)
                    throw new AvroErrors.DataValidationError("Data in path %j, has extra fields not in schema. Extranous fields: %j \n Fields in data: [%j]. \n Fields in schema: [%j]", path, _.difference(dFields, intersect),dFields, fields);
                break;
            case 'map': 
              if ( _.isNull( datum ) || _.isArray( datum ) || _.isFunction( datum ) || !_.isObject( datum ) ) 
                throw new AvroErrors.DataValidationError("Data [%j] not a an object", datum, this.symbols);
              break;                
            default:
                break;
        }

        return true;
    },

    validate: function(schema, datum){
        var self = this;
        try {
            return self.validateAndThrow(schema, datum, []);
        } catch (validateErr) {
            return false;
        }
    },

    isPrimitive: function(schema){
        switch (schema) {
            case 'null':
            case 'boolean':
            case 'int':
            case 'long':
            case 'float':
            case 'double':
            case 'bytes':
            case 'string':
                return true;
        }
        return false;
    },

    toString: function() {
        return JSON.stringify({ type: this.type });
    }
});

function PrimitiveSchema(type) {

    if (!_.isString(type)) {
        throw new AvroErrors.InvalidSchemaError('Primitive type name must be a string');
    }
    if (!_.contains(PRIMITIVE_TYPES, type)) {
        throw new AvroErrors.InvalidSchemaError('Primitive type must be one of: %s; got %s',
                                         JSON.stringify(PRIMITIVE_TYPES), type);
    }

    this.type = type;
}

util.inherits(PrimitiveSchema, Schema);

function FieldSchema(name, type, defaultValue) {
    if (!_.isString(name)) {
        throw new AvroErrors.InvalidSchemaError('Field name must be string');
    }

    if (!(type instanceof Schema)) {
        throw new AvroErrors.InvalidSchemaError('Field type must be a Schema object');
    }

    this.name = name;
    this.type = type;
    this.default = defaultValue;
}

util.inherits(FieldSchema, Schema);

function NamedSchema(name, namespace) {

}

function RecordSchema(name, namespace, fields) {
    if (!_.isString(name)) {
        throw new AvroErrors.InvalidSchemaError('Record name must be string');
    }

    if (!_.isNull(namespace) && !_.isUndefined(namespace) && !_.isString(namespace)) {
        throw new AvroErrors.InvalidSchemaError('Record namespace must be string or null');
    }

    if (!_.isArray(fields)) {
        throw new AvroErrors.InvalidSchemaError('Fields must be an array');
    }

    this.type = 'record';
    this.name = name;
    this.namespace = namespace;
    this.fields = fields;

    this.fieldsHash = _.reduce(fields, function(hash, field) {
        hash[field.name] = field;
        return hash;
    }, {});
};

util.inherits(RecordSchema, Schema);

function MapSchema(type, defaultValue) {
    this.type = 'map';
    this.values = type;
    this.default = defaultValue;
}

util.inherits(MapSchema, Schema);

function ArraySchema(items, defaultValue) {
    if (_.isNull(items) || _.isUndefined(items)) {
        throw new AvroErrors.InvalidSchemaError('Array "items" schema should not be null or undefined');
    }

    this.type = 'array';
    this.items = items;
    this.default = defaultValue;
}

util.inherits(ArraySchema, Schema);

function UnionSchema(schemas, namespace, defaultValue) {
    if (!_.isArray(schemas) || _.isEmpty(schemas)) {
        throw new InvalidSchemaError('Union must have at least 1 branch');
    }

    this.type = 'union';
    this.schemas = schemas; //_.map(schemas, function(type) { return makeFullyQualifiedTypeName(type, namespace); });
    this.namespace = namespace;
    this.default = defaultValue;
}

util.inherits(UnionSchema, Schema);

function EnumSchema(symbols, defaultValue) {
    if (!_.isArray(symbols)) {
        throw new AvroErrors.InvalidSchemaError('Enum must have array of symbols, got %s',
                                         JSON.stringify(symbols));
    }
    if (!_.all(symbols, function(symbol) { return _.isString(symbol); })) {
        throw new AvroErrors.InvalidSchemaError('Enum symbols must be strings, got %s',
                                         JSON.stringify(symbols));
    }

    this.type = 'enum';
    this.symbols = symbols;
    this.default = defaultValue;
}

util.inherits(EnumSchema, Schema);

function FixedSchema(name, size, defaultValue) {

    this.type = 'fixed';
    this.name = name;
    this.size = size;
    this.default = defaultValue;
}

util.inherits(FixedSchema, Schema);

if (!_.isUndefined(exports)) {
    exports.Schema = Schema;
    exports.PrimitiveSchema = PrimitiveSchema;
    exports.ArraySchema = ArraySchema;
    exports.MapSchema = MapSchema;
    exports.UnionSchema = UnionSchema;
    exports.RecordSchema = RecordSchema;
    exports.FixedSchema = FixedSchema;
    exports.EnumSchema = EnumSchema;
}
