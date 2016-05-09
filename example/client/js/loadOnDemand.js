/*global angular*/
(function (ng) {
    'use strict';
    var aModule = ng.module('loadOnDemand', []);

    aModule.factory('scriptCache', ['$cacheFactory', function ($cacheFactory) {
        return $cacheFactory('scriptCache', {capacity: 10});
    }]);

    aModule.provider('$loadOnDemand',
        ['$controllerProvider', '$provide', '$compileProvider', '$filterProvider',
            function ($controllerProvider, $provide, $compileProvider, $filterProvider) {
                var regModules = {ng: true};
                var modules = {},
                    providers = {
                        $controllerProvider: $controllerProvider,
                        $compileProvider: $compileProvider,
                        $filterProvider: $filterProvider,
                        $provide: $provide // other things
                    };
                this.$get = ['scriptCache', '$log', '$document', '$injector', '$q', '$rootScope',
                    function (scriptCache, $log, $document, $injector, $q, $rootScope) {
                        return {
                            getConfig: function (name) {
                                return modules[name];
                            },
                            load: function (name) {
                                var self = this,
                                    moduleCache = {};
                                return self.getConfig(name) ?
                                    loadScript(name) :
                                    $q.reject(new Error('Module "' + name + '" not configured'));

                                function loadScript(requireModule) {
                                    var requireModuleConfig = self.getConfig(requireModule);
                                    if (!requireModuleConfig) {
                                        return $q.reject(new Error('module "' + requireModule + '" not loaded and not configured'));
                                    }
                                    var resourceId = 'script:' + requireModuleConfig.script;
                                    var script = scriptCache.get(resourceId);
                                    if (!script) {
                                        script = download()
                                            .then(loadDependencies)
                                            .then(null, function (e) {
                                                scriptCache.remove(resourceId);
                                                if (e.message) {
                                                    e.message += ' from module "' + requireModule + '"'
                                                }
                                                $log.error(e);
                                            });
                                        scriptCache.put(resourceId, script);
                                    }
                                    return script;

                                    function download() {
                                        var deferred = $q.defer();
                                        try {
                                            var url = requireModuleConfig.script;
                                            var scriptElement = $document[0].createElement('script');
                                            scriptElement.src = url;
                                            scriptElement.onload = function () {
                                                deferred.resolve();
                                                $rootScope.$apply();
                                            };
                                            scriptElement.onerror = function () {
                                                deferred.reject(new Error('Error loading "' + url + '"'));
                                            };
                                            $document[0].documentElement.appendChild(scriptElement);
                                        }
                                        catch (e) {
                                            deferred.reject(e);
                                        }
                                        return deferred.promise;
                                    }

                                    function loadDependencies() {
                                        var moduleName = requireModuleConfig.name;
                                        if (regModules[moduleName]) {
                                            return $q.when(moduleName);
                                        }
                                        var loadedModule = ng.module(moduleName);
                                        var requirePromises = [];
                                        ng.forEach(loadedModule.requires, function (requireModule) {
                                            if (!regModules[requireModule]) {
                                                if (moduleExists(requireModule)) {
                                                    regModules[requireModule] = true;
                                                }
                                                else {
                                                    if (!moduleCache[requireModule]) {
                                                        moduleCache[requireModule] = loadScript(requireModule);
                                                    }
                                                    requirePromises.push(moduleCache[requireModule]);
                                                }
                                            }
                                        });
                                        return $q.all(requirePromises).then(function () {
                                            register($injector, moduleName);
                                            regModules[moduleName] = true;
                                        });
                                    }
                                }
                            }
                        };
                    }];

                this.config = function (config) {
                    init(ng.element(window.document));
                    if (ng.isArray(config)) {
                        ng.forEach(config, function (moduleConfig) {
                            modules[moduleConfig.name] = moduleConfig;
                        });
                    } else {
                        modules[config.name] = config;
                    }
                };

                function register($injector, moduleName) {
                    var moduleFn = ng.module(moduleName);
                    ng.forEach(moduleFn._invokeQueue, function (invokeArgs) {
                        if (!providers.hasOwnProperty(invokeArgs[0])) {
                            throw new Error('unsupported provider ' + invokeArgs[0]);
                        }
                        var provider = providers[invokeArgs[0]];
                        provider[invokeArgs[1]].apply(provider, invokeArgs[2]);
                    });
                    ng.forEach(moduleFn._runBlocks, function (fn) {
                        $injector.invoke(fn);
                    });
                }

                function moduleExists(moduleName) {
                    try {
                        ng.module(moduleName);
                    } catch (e) {
                        if (/No module/.test(e) || (e.message.indexOf('$injector:nomod') > -1)) {
                            return false;
                        }
                    }
                    return true;
                }

                function init(element) {
                    var elements = [element],
                        isReg = false,
                        names = ['ng:app', 'ng-app', 'x-ng-app', 'data-ng-app'],
                        NG_APP_CLASS_REGEXP = /\sng[:\-]app(:\s*([\w\d_]+);?)?\s/;

                    function append(elm) {
                        return elm && elements.push(elm);
                    }

                    ng.forEach(names, function (name) {
                        names[name] = true;
                        append(document.getElementById(name));
                        name = name.replace(':', '\\:');
                        if (element.querySelectorAll) {
                            ng.forEach(element.querySelectorAll('.' + name), append);
                            ng.forEach(element.querySelectorAll('.' + name + '\\:'), append);
                            ng.forEach(element.querySelectorAll('[' + name + ']'), append);
                        }
                    });

                    ng.forEach(elements, function (elm) {
                        if (!isReg) {
                            var className = ' ' + element.className + ' ';
                            var match = NG_APP_CLASS_REGEXP.exec(className);
                            if (match) {
                                isReg = addReg((match[2] || '').replace(/\s+/g, ','));
                            } else {
                                ng.forEach(elm.attributes, function (attr) {
                                    if (!isReg && names[attr.name]) {
                                        isReg = addReg(attr.value);
                                    }
                                });
                            }
                        }
                    });

                    function addReg(module) {
                        if (!regModules[module]) {
                            regModules[module] = true;
                            var mainModule = ng.module(module);
                            ng.forEach(mainModule.requires, addReg);
                        }
                        return regModules[module];
                    }
                }
            }]);

    aModule.directive('loadOnDemand', ['$http', 'scriptCache', '$log', '$loadOnDemand', '$compile', '$q',
        function ($http, scriptCache, $log, $loadOnDemand, $compile, $q) {
            return {
                link: function (scope, element, attr) {
                    var currentName;
                    var clearContent = ng.noop;

                    function loadTemplate(moduleName) {
                        var moduleConfig = $loadOnDemand.getConfig(moduleName);
                        if (!moduleConfig.template) {
                            return $q.reject(null);
                        }
                        var resourceId = 'view:' + moduleConfig.template;
                        var template = scriptCache.get(resourceId);
                        if (!template) {
                            template = $http.get(moduleConfig.template).
                                then(function (data) {
                                    return data.data;
                                }, function (data) {
                                    $log.error('Error load template "' + moduleConfig.template + "': " + data);
                                    return $q.reject(data.data);
                                });
                            scriptCache.put(resourceId, template);
                        }
                        return template;
                    }

                    scope.$watch(attr.loadOnDemand, function (moduleName) {
                        currentName = moduleName;
                        if (moduleName) {
                            $loadOnDemand.load(moduleName)
                                .then(function () {
                                    return loadTemplate(moduleName)
                                        .then(function (template) {
                                            if (currentName === moduleName) {
                                                clearContent();
                                                var childScope = scope.$new();
                                                element.html(template);
                                                $compile(element.contents())(childScope);
                                                clearContent = function() {
                                                    childScope.$destroy();
                                                    element.html('');
                                                    clearContent = ng.noop;
                                                }
                                            }
                                        });

                                });
                        }
                        else {
                            clearContent();
                        }
                    });

                }
            };
        }]);

})(angular);
