package storage.redis

import akka.http.scaladsl.util.FastFuture
import akka.http.scaladsl.util.FastFuture._
import auth.{AuthModuleConfig, GenericOauth2ModuleConfig}
import com.typesafe.config.ConfigRenderOptions
import env.Env
import models._
import org.joda.time.DateTime
import otoroshi.script.Script
import otoroshi.tcp.TcpService
import play.api.Logger
import play.api.libs.json._
import redis.RedisClientMasterSlaves
import security.Auth0Config
import ssl.{Cert, ClientCertificateValidator}
import utils.JsonImplicits._

import scala.concurrent.duration._
import scala.concurrent.{Await, ExecutionContext, Future}
import scala.util.Success

class RedisGlobalConfigDataStore(redisCli: RedisClientMasterSlaves, _env: Env)
    extends GlobalConfigDataStore
    with RedisStore[GlobalConfig] {

  lazy val logger = Logger("otoroshi-redis-globalconfig-datastore")

  override def fmt: Format[GlobalConfig] = GlobalConfig._fmt

  override def key(id: String): Key =
    Key.Empty / _env.storageRoot / "config" / "global" // WARN : its a singleton, id is always global

  override def extractId(value: GlobalConfig): String = "global" // WARN : its a singleton, id is always global

  override def _redis(implicit env: Env): RedisClientMasterSlaves = redisCli

  def throttlingKey(): String = s"${_env.storageRoot}:throttling:global"

  private val callsForIpAddressCache =
    new java.util.concurrent.ConcurrentHashMap[String, java.util.concurrent.atomic.AtomicLong]()
  private val quotasForIpAddressCache =
    new java.util.concurrent.ConcurrentHashMap[String, java.util.concurrent.atomic.AtomicLong]()

  def incrementCallsForIpAddressWithTTL(ipAddress: String,
                                        ttl: Int = 10)(implicit ec: ExecutionContext): Future[Long] = {

    @inline
    def actualCall() = redisCli.incrby(s"${_env.storageRoot}:throttling:perip:$ipAddress", 1L).flatMap { secCalls =>
      if (!callsForIpAddressCache.containsKey(ipAddress)) {
        callsForIpAddressCache.putIfAbsent(ipAddress, new java.util.concurrent.atomic.AtomicLong(secCalls))
      } else {
        callsForIpAddressCache.get(ipAddress).set(secCalls)
      }
      redisCli
        .pttl(s"${_env.storageRoot}:throttling:perip:$ipAddress")
        .filter(_ > -1)
        .recoverWith {
          case _ => redisCli.expire(s"${_env.storageRoot}:throttling:perip:$ipAddress", ttl)
        }
        .fast
        .map(_ => secCalls)
    }

    if (callsForIpAddressCache.containsKey(ipAddress)) {
      actualCall()
      FastFuture.successful(callsForIpAddressCache.get(ipAddress).get)
    } else {
      actualCall()
    }
  }

  def quotaForIpAddress(ipAddress: String)(implicit ec: ExecutionContext): Future[Option[Long]] = {
    @inline
    def actualCall() =
      redisCli
        .get(s"${_env.storageRoot}:throttling:peripquota:$ipAddress")
        .fast
        .map(_.map(_.utf8String.toLong))
        .andThen {
          case Success(Some(quota)) if !quotasForIpAddressCache.containsKey(ipAddress) =>
            quotasForIpAddressCache.putIfAbsent(ipAddress, new java.util.concurrent.atomic.AtomicLong(quota))
          case Success(Some(quota)) if quotasForIpAddressCache.containsKey(ipAddress) =>
            quotasForIpAddressCache.get(ipAddress).set(quota)
        }
    quotasForIpAddressCache.containsKey(ipAddress) match {
      case true =>
        actualCall()
        FastFuture.successful(Some(quotasForIpAddressCache.get(ipAddress).get))
      case false => actualCall()
    }
  }

  override def allEnv()(implicit ec: ExecutionContext, env: Env): Future[Set[String]] =
    singleton().fast.map(_.lines.toSet)

  override def isOtoroshiEmpty()(implicit ec: ExecutionContext): Future[Boolean] =
    redisCli.keys(key("global").key).map(_.isEmpty)

  private val throttlingQuotasCache = new java.util.concurrent.atomic.AtomicLong(0L)

  override def withinThrottlingQuota()(implicit ec: ExecutionContext, env: Env): Future[Boolean] = {
    val config = latest()
    //singleton().fast.map { config =>
    redisCli.get(throttlingKey()).fast.map { bs =>
      throttlingQuotasCache.set(bs.map(_.utf8String.toLong).getOrElse(0L))
      throttlingQuotasCache.get() <= (config.throttlingQuota * 10L)
    }
    //}
  }
  // singleton().flatMap { config =>
  //   redisCli.get(throttlingKey()).map { bs =>
  //     val count = bs.map(_.utf8String.toLong).getOrElse(0L)
  //     count <= (config.throttlingQuota * 10L)
  //   }
  // }

  def quotasValidationFor(from: String)(implicit ec: ExecutionContext,
                                        env: Env): Future[(Boolean, Long, Option[Long])] = {
    val a = withinThrottlingQuota()
    val b = incrementCallsForIpAddressWithTTL(from)
    val c = quotaForIpAddress(from)
    for {
      within     <- a
      secCalls   <- b
      maybeQuota <- c
    } yield (within, secCalls, maybeQuota)
  }

  override def updateQuotas(config: models.GlobalConfig)(implicit ec: ExecutionContext, env: Env): Future[Unit] =
    for {
      secCalls <- redisCli.incrby(throttlingKey(), 1L)
      _        <- redisCli.ttl(throttlingKey()).filter(_ > -1).recoverWith { case _ => redisCli.expire(throttlingKey(), 10) }
      fu       = env.metrics.markLong(s"global.throttling-quotas", secCalls)
    } yield ()

  private val configCache     = new java.util.concurrent.atomic.AtomicReference[GlobalConfig](null)
  private val lastConfigCache = new java.util.concurrent.atomic.AtomicLong(0L)

  override def latest()(implicit ec: ExecutionContext, env: Env): GlobalConfig = {
    val ref = configCache.get()
    if (ref == null) {
      Await.result(singleton(), 1.second) // WARN: await here should never be executed or only once per otoroshi instance
    } else {
      ref
    }
  }

  override def latestSafe: Option[GlobalConfig] = Option(configCache.get())

  override def singleton()(implicit ec: ExecutionContext, env: Env): Future[GlobalConfig] = {
    val time = System.currentTimeMillis
    val ref  = configCache.get()
    if (ref == null) {
      lastConfigCache.set(time)
      logger.trace("Fetching GlobalConfig for the first time")
      findById("global").fast.map(_.get).andThen {
        case Success(conf) =>
          lastConfigCache.set(time)
          configCache.set(conf)
      }
    } else {
      if ((lastConfigCache.get() + 6000) < time) {
        lastConfigCache.set(time)
        findById("global").fast.map(_.get).andThen {
          case Success(conf) => configCache.set(conf)
        }
      } else if ((lastConfigCache.get() + 5000) < time) {
        lastConfigCache.set(time)
        findById("global").fast.map(_.get).andThen {
          case Success(conf) => configCache.set(conf)
        }
        FastFuture.successful(ref)
      } else {
        FastFuture.successful(ref)
      }
    }
  }

  override def set(value: GlobalConfig, pxMilliseconds: Option[Duration] = None)(implicit ec: ExecutionContext,
                                                                                 env: Env): Future[Boolean] = {
    super.set(value, pxMilliseconds)(ec, env).andThen {
      case Success(_) => configCache.set(value)
    }
  }

  override def fullImport(export: JsObject)(implicit ec: ExecutionContext, env: Env): Future[Unit] = {
    val config             = GlobalConfig.fromJsons((export \ "config").asOpt[JsObject].getOrElse(GlobalConfig().toJson))
    val admins             = (export \ "admins").asOpt[JsArray].getOrElse(Json.arr())
    val simpleAdmins       = (export \ "simpleAdmins").asOpt[JsArray].getOrElse(Json.arr())
    val serviceGroups      = (export \ "serviceGroups").asOpt[JsArray].getOrElse(Json.arr())
    val apiKeys            = (export \ "apiKeys").asOpt[JsArray].getOrElse(Json.arr())
    val serviceDescriptors = (export \ "serviceDescriptors").asOpt[JsArray].getOrElse(Json.arr())
    val errorTemplates     = (export \ "errorTemplates").asOpt[JsArray].getOrElse(Json.arr())
    val jwtVerifiers       = (export \ "jwtVerifiers").asOpt[JsArray].getOrElse(Json.arr())
    val authConfigs        = (export \ "authConfigs").asOpt[JsArray].getOrElse(Json.arr())
    val certificates       = (export \ "certificates").asOpt[JsArray].getOrElse(Json.arr())
    val clientValidators   = (export \ "clientValidators").asOpt[JsArray].getOrElse(Json.arr())
    val scripts            = (export \ "scripts").asOpt[JsArray].getOrElse(Json.arr())
    val tcpServices        = (export \ "tcpServices").asOpt[JsArray].getOrElse(Json.arr())

    for {
      _ <- redisCli.keys(s"${env.storageRoot}:*").flatMap(keys => redisCli.del(keys: _*))
      _ <- config.save()
      _ <- Future.sequence(
            admins.value.map(
              v =>
                redisCli.set(
                  s"${env.storageRoot}:u2f:users:${(v \ "randomId").asOpt[String].getOrElse((v \ "username").as[String])}",
                  Json.stringify(v)
              )
            )
          )
      _ <- Future.sequence(
            simpleAdmins.value.map(
              v => redisCli.set(s"${env.storageRoot}:admins:${(v \ "username").as[String]}", Json.stringify(v))
            )
          )
      _ <- Future.sequence(serviceGroups.value.map(ServiceGroup.fromJsons).map(_.save()))
      _ <- Future.sequence(apiKeys.value.map(ApiKey.fromJsons).map(_.save()))
      _ <- Future.sequence(serviceDescriptors.value.map(ServiceDescriptor.fromJsons).map(_.save()))
      _ <- Future.sequence(errorTemplates.value.map(ErrorTemplate.fromJsons).map(_.save()))
      _ <- Future.sequence(jwtVerifiers.value.map(GlobalJwtVerifier.fromJsons).map(_.save()))
      _ <- Future.sequence(authConfigs.value.map(AuthModuleConfig.fromJsons).map(_.save()))
      _ <- Future.sequence(certificates.value.map(Cert.fromJsons).map(_.save()))
      _ <- Future.sequence(clientValidators.value.map(ClientCertificateValidator.fromJsons).map(_.save()))
      _ <- Future.sequence(scripts.value.map(Script.fromJsons).map(_.save()))
      _ <- Future.sequence(tcpServices.value.map(TcpService.fromJsons).map(_.save()))
    } yield ()
  }

  override def fullExport()(implicit ec: ExecutionContext, env: Env): Future[JsValue] = {
    val appConfig =
      Json.parse(
        env.configuration
          .getOptional[play.api.Configuration]("app")
          .get
          .underlying
          .root()
          .render(ConfigRenderOptions.concise())
      )
    for {
      config           <- env.datastores.globalConfigDataStore.singleton()
      descs            <- env.datastores.serviceDescriptorDataStore.findAll()
      apikeys          <- env.datastores.apiKeyDataStore.findAll()
      groups           <- env.datastores.serviceGroupDataStore.findAll()
      tmplts           <- env.datastores.errorTemplateDataStore.findAll()
      calls            <- env.datastores.serviceDescriptorDataStore.globalCalls()
      dataIn           <- env.datastores.serviceDescriptorDataStore.globalDataIn()
      dataOut          <- env.datastores.serviceDescriptorDataStore.globalDataOut()
      admins           <- env.datastores.u2FAdminDataStore.findAll()
      simpleAdmins     <- env.datastores.simpleAdminDataStore.findAll()
      jwtVerifiers     <- env.datastores.globalJwtVerifierDataStore.findAll()
      authConfigs      <- env.datastores.authConfigsDataStore.findAll()
      certificates     <- env.datastores.certificatesDataStore.findAll()
      clientValidators <- env.datastores.clientCertificateValidationDataStore.findAll()
      scripts          <- env.datastores.scriptDataStore.findAll()
      tcpServices      <- env.datastores.tcpServiceDataStore.findAll()
    } yield
      Json.obj(
        "label"   -> "Otoroshi export",
        "dateRaw" -> DateTime.now(),
        "date"    -> DateTime.now().toString("yyyy-MM-dd hh:mm:ss"),
        "stats" -> Json.obj(
          "calls"   -> calls,
          "dataIn"  -> dataIn,
          "dataOut" -> dataOut
        ),
        "config"             -> config.toJson,
        "appConfig"          -> appConfig,
        "admins"             -> JsArray(admins),
        "simpleAdmins"       -> JsArray(simpleAdmins),
        "serviceGroups"      -> JsArray(groups.map(_.toJson)),
        "apiKeys"            -> JsArray(apikeys.map(_.toJson)),
        "serviceDescriptors" -> JsArray(descs.map(_.toJson)),
        "errorTemplates"     -> JsArray(tmplts.map(_.toJson)),
        "jwtVerifiers"       -> JsArray(jwtVerifiers.map(_.asJson)),
        "authConfigs"        -> JsArray(authConfigs.map(_.asJson)),
        "certificates"       -> JsArray(certificates.map(_.toJson)),
        "clientValidators"   -> JsArray(clientValidators.map(_.asJson)),
        "scripts"            -> JsArray(scripts.map(_.toJson)),
        "tcpServices"        -> JsArray(tcpServices.map(_.json))
      )
  }

  override def migrate()(implicit ec: ExecutionContext, env: Env): Future[Unit] = {
    val migrationKey = s"${_env.storageRoot}:migrations:globalconfig:before130"
    redisCli.get(key("global").key).map(_.get).flatMap { configBS =>
      val json = Json.parse(configBS.utf8String)
      ((json \ "backofficeAuth0Config").asOpt[JsValue], (json \ "privateAppsAuth0Config").asOpt[JsValue]) match {
        case (Some(_), Some(_)) => {
          redisCli.get(migrationKey).flatMap {
            case Some(_) => FastFuture.successful(())
            case None => {
              logger.info("OAuth config migration - Saving global configuration before migration")
              for {
                _ <- redisCli.set(s"${_env.storageRoot}:migrations:globalconfig:before130", configBS)
                backofficeAuth0Config = (json \ "backofficeAuth0Config").asOpt[JsValue].flatMap { config =>
                  (
                    (config \ "clientId").asOpt[String].filter(_.nonEmpty),
                    (config \ "clientSecret").asOpt[String].filter(_.nonEmpty),
                    (config \ "domain").asOpt[String].filter(_.nonEmpty),
                    (config \ "callbackUrl").asOpt[String].filter(_.nonEmpty)
                  ) match {
                    case (Some(clientId), Some(clientSecret), Some(domain), Some(callbackUrl)) =>
                      Some(Auth0Config(clientSecret, clientId, callbackUrl, domain))
                    case _ => None
                  }
                }
                privateAppsAuth0Config = (json \ "privateAppsAuth0Config").asOpt[JsValue].flatMap { config =>
                  (
                    (config \ "clientId").asOpt[String].filter(_.nonEmpty),
                    (config \ "clientSecret").asOpt[String].filter(_.nonEmpty),
                    (config \ "domain").asOpt[String].filter(_.nonEmpty),
                    (config \ "callbackUrl").asOpt[String].filter(_.nonEmpty)
                  ) match {
                    case (Some(clientId), Some(clientSecret), Some(domain), Some(callbackUrl)) =>
                      Some(Auth0Config(clientSecret, clientId, callbackUrl, domain))
                    case _ => None
                  }
                }
                _ = logger.info("OAuth config migration - creating global oauth configuration for private apps")
                _ <- privateAppsAuth0Config
                      .map(
                        c =>
                          env.datastores.authConfigsDataStore.set(
                            GenericOauth2ModuleConfig(
                              id = "confidential-apps",
                              name = "Confidential apps Auth0 provider",
                              desc = "Use to be the Auth0 global config. for private apps",
                              clientId = c.clientId,
                              clientSecret = c.secret,
                              tokenUrl = s"https://${c.domain}/oauth/token",
                              authorizeUrl = s"https://${c.domain}/authorize",
                              userInfoUrl = s"https://${c.domain}/userinfo",
                              loginUrl = s"https://${c.domain}/authorize",
                              logoutUrl = s"https://${c.domain}/logout",
                              callbackUrl = c.callbackURL
                            )
                        )
                      )
                      .getOrElse(FastFuture.successful(()))
                _ = logger.info("OAuth config migration - creating global oauth configuration for otoroshi backoffice")
                _ <- backofficeAuth0Config
                      .map(
                        c =>
                          env.datastores.authConfigsDataStore.set(
                            GenericOauth2ModuleConfig(
                              id = "otoroshi-backoffice",
                              name = "Otoroshi backoffic Auth0 provider",
                              desc = "Use to be the Auth0 global config. for Otoroshi backoffice",
                              clientId = c.clientId,
                              clientSecret = c.secret,
                              tokenUrl = s"https://${c.domain}/oauth/token",
                              authorizeUrl = s"https://${c.domain}/authorize",
                              userInfoUrl = s"https://${c.domain}/userinfo",
                              loginUrl = s"https://${c.domain}/authorize",
                              logoutUrl = s"https://${c.domain}/logout",
                              callbackUrl = c.callbackURL
                            )
                        )
                      )
                      .getOrElse(FastFuture.successful(()))
                _      = logger.info("OAuth config migration - creating global oauth configuration for otoroshi backoffice")
                config <- env.datastores.globalConfigDataStore.findById("global").map(_.get)
                configWithBackOffice = backofficeAuth0Config
                  .map(_ => config.copy(backOfficeAuthRef = Some("otoroshi-backoffice")))
                  .getOrElse(config)
                _ <- configWithBackOffice.save()
                _ = logger.info("OAuth config migration - migration done !")
              } yield ()
            }
          }
        }
        case _ => FastFuture.successful(())
      }
    }
  }
}
